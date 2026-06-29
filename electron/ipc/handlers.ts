import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	app,
	BrowserWindow,
	desktopCapturer,
	dialog,
	ipcMain,
	screen,
	shell,
	systemPreferences,
} from "electron";
import type {
	DocsieEstimateInput,
	DocsieGenerateVideoToDocsInput,
	DocsieGenerateVoiceoverInput,
	DocsieIntegrationConfigInput,
	DocsieListDocumentationShelvesInput,
	DocsieListVoiceOptionsInput,
	DocsieSaveVideoToDocsHistoryInput,
	DocsieStartVideoToDocsInput,
	DocsieTranscribeAudioInput,
} from "../../src/lib/docsieIntegration";
import {
	type AppendRecordingChunkInput,
	type BeginRecordingSessionInput,
	type DiscardRecordingSessionInput,
	type FinishRecordingSessionInput,
	normalizeProjectMedia,
	normalizeRecordingSession,
	type ProjectMedia,
	type RecordingAssetKind,
	type RecordingSession,
	type ReplaceRecordingAssetInput,
	type StoreRecordedSessionInput,
} from "../../src/lib/recordingSession";
import { mainT } from "../i18n";
import { RECORDINGS_DIR } from "../main";
import {
	estimateDocsieVideoToDocs,
	generateDocsieVideoToDocs,
	generateDocsieVoiceover,
	getDocsieBackgroundJob,
	getDocsieCreditBalance,
	getDocsieIntegrationState,
	getDocsieVideoToDocsJobResult,
	getDocsieVideoToDocsJobStatus,
	listDocsieDocumentationShelves,
	listDocsieGenerationTemplates,
	listDocsieTranscriptionOptions,
	listDocsieVideoToDocsHistory,
	listDocsieVoiceOptions,
	listDocsieWorkspaces,
	saveDocsieIntegrationConfig,
	saveDocsieVideoToDocsHistory,
	startDocsieVideoToDocs,
	transcribeDocsieAudio,
} from "./docsie";

const PROJECT_FILE_EXTENSION = "docsiescreen";
const SHORTCUTS_FILE = path.join(app.getPath("userData"), "shortcuts.json");
const RECORDING_SESSION_SUFFIX = ".session.json";
const ALLOWED_IMPORT_VIDEO_EXTENSIONS = new Set([".webm", ".mp4", ".mov", ".avi", ".mkv"]);

/**
 * Paths explicitly approved by the user via file picker dialogs or project loads.
 * These are added at runtime when the user selects files from outside the default directories.
 */
const approvedPaths = new Set<string>();

function approveFilePath(filePath: string): void {
	approvedPaths.add(path.resolve(filePath));
}

function getAllowedReadDirs(): string[] {
	return [RECORDINGS_DIR];
}

function isPathWithinDir(filePath: string, dirPath: string): boolean {
	const resolved = path.resolve(filePath);
	const resolvedDir = path.resolve(dirPath);
	return resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep);
}

function isPathAllowed(filePath: string): boolean {
	const resolved = path.resolve(filePath);
	if (approvedPaths.has(resolved)) return true;
	return getAllowedReadDirs().some((dir) => isPathWithinDir(resolved, dir));
}

function hasAllowedImportVideoExtension(filePath: string): boolean {
	return ALLOWED_IMPORT_VIDEO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function approveReadableVideoPath(
	filePath?: string | null,
	trustedDirs?: string[],
): Promise<string | null> {
	const normalizedPath = normalizeVideoSourcePath(filePath);
	if (!normalizedPath) {
		return null;
	}

	if (isPathAllowed(normalizedPath)) {
		return normalizedPath;
	}

	if (!hasAllowedImportVideoExtension(normalizedPath)) {
		return null;
	}

	// When called with trustedDirs (e.g. from project load), only auto-approve
	// paths within those directories. This prevents malicious project files from
	// approving reads to arbitrary filesystem locations.
	if (trustedDirs) {
		const resolved = path.resolve(normalizedPath);
		const withinTrusted = trustedDirs.some((dir) => isPathWithinDir(resolved, dir));
		if (!withinTrusted) {
			return null;
		}
	}

	try {
		const stats = await fs.stat(normalizedPath);
		if (!stats.isFile()) {
			return null;
		}
	} catch {
		return null;
	}

	approveFilePath(normalizedPath);
	return normalizedPath;
}

function resolveRecordingOutputPath(fileName: string): string {
	const trimmed = fileName.trim();
	if (!trimmed) {
		throw new Error("Invalid recording file name");
	}

	const parsedPath = path.parse(trimmed);
	const hasTraversalSegments = trimmed.split(/[\\/]+/).some((segment) => segment === "..");
	const isNestedPath =
		parsedPath.dir !== "" ||
		path.isAbsolute(trimmed) ||
		trimmed.includes("/") ||
		trimmed.includes("\\");
	if (hasTraversalSegments || isNestedPath || parsedPath.base !== trimmed) {
		throw new Error("Recording file name must not contain path segments");
	}

	return path.join(RECORDINGS_DIR, parsedPath.base);
}

async function getApprovedProjectSession(
	project: unknown,
	projectFilePath?: string,
): Promise<RecordingSession | null> {
	if (!project || typeof project !== "object") {
		return null;
	}

	const rawProject = project as { media?: unknown; videoPath?: unknown };
	const media: ProjectMedia | null =
		normalizeProjectMedia(rawProject.media) ??
		(typeof rawProject.videoPath === "string"
			? {
					screenVideoPath: normalizeVideoSourcePath(rawProject.videoPath) ?? rawProject.videoPath,
				}
			: null);

	if (!media) {
		return null;
	}

	// Only auto-approve media paths within the project's directory or RECORDINGS_DIR.
	// This prevents crafted project files from approving reads to arbitrary locations.
	const trustedDirs = [RECORDINGS_DIR];
	if (projectFilePath) {
		trustedDirs.push(path.dirname(path.resolve(projectFilePath)));
	}

	const screenVideoPath = await approveReadableVideoPath(media.screenVideoPath, trustedDirs);
	if (!screenVideoPath) {
		throw new Error("Project references an invalid or unsupported screen video path");
	}

	const webcamVideoPath = media.webcamVideoPath
		? await approveReadableVideoPath(media.webcamVideoPath, trustedDirs)
		: undefined;
	if (media.webcamVideoPath && !webcamVideoPath) {
		throw new Error("Project references an invalid or unsupported webcam video path");
	}

	const audioPath = media.audioPath
		? await approveReadableVideoPath(media.audioPath, trustedDirs)
		: undefined;
	if (media.audioPath && !audioPath) {
		throw new Error("Project references an invalid or unsupported audio path");
	}

	return {
		screenVideoPath,
		...(webcamVideoPath ? { webcamVideoPath } : {}),
		...(audioPath ? { audioPath } : {}),
		createdAt: Date.now(),
	};
}

type SelectedSource = {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
};

type ScreenCaptureAccessState = {
	platform: NodeJS.Platform;
	status: "not-determined" | "granted" | "denied" | "restricted" | "unknown";
	granted: boolean;
	appName: string;
	executablePath: string;
	error?: string;
};

let selectedSource: SelectedSource | null = null;
let currentProjectPath: string | null = null;
let currentRecordingSession: RecordingSession | null = null;

type StreamingRecordingAsset = {
	filePath: string;
	queue: Promise<void>;
	bytesWritten: number;
	chunkCount: number;
};

type StreamingRecordingSession = {
	recordingId: number;
	createdAt: number;
	screen: StreamingRecordingAsset;
	webcam?: StreamingRecordingAsset;
	audio?: StreamingRecordingAsset;
};

const streamingRecordingSessions = new Map<number, StreamingRecordingSession>();

function getScreenCaptureAccessState(): ScreenCaptureAccessState {
	const baseState = {
		platform: process.platform,
		appName: app.getName(),
		executablePath: process.execPath,
	};

	if (process.platform !== "darwin") {
		return {
			...baseState,
			status: "granted",
			granted: true,
		};
	}

	try {
		const status = systemPreferences.getMediaAccessStatus("screen");
		return {
			...baseState,
			status,
			granted: status === "granted",
		};
	} catch (error) {
		return {
			...baseState,
			status: "unknown",
			granted: false,
			error: String(error),
		};
	}
}

function nativeImageToDataUrl(image: Electron.NativeImage | null | undefined): string | null {
	if (!image || image.isEmpty()) {
		return null;
	}

	return image.toDataURL();
}

function serializeDesktopSource(source: Electron.DesktopCapturerSource): SelectedSource {
	return {
		id: source.id,
		name: source.name,
		display_id: source.display_id,
		thumbnail: nativeImageToDataUrl(source.thumbnail),
		appIcon: nativeImageToDataUrl(source.appIcon),
	};
}

function normalizeSelectedSource(source: unknown): SelectedSource | null {
	if (!source || typeof source !== "object") {
		return null;
	}

	const candidate = source as Partial<SelectedSource>;
	if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
		return null;
	}

	return {
		id: candidate.id,
		name: candidate.name,
		display_id: typeof candidate.display_id === "string" ? candidate.display_id : "",
		thumbnail: typeof candidate.thumbnail === "string" ? candidate.thumbnail : null,
		appIcon: typeof candidate.appIcon === "string" ? candidate.appIcon : null,
	};
}

async function getPrimaryScreenSource(): Promise<SelectedSource | null> {
	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: { width: 0, height: 0 },
		fetchWindowIcons: false,
	});
	const screenSources = sources.filter((source) => source.id.startsWith("screen:"));
	if (screenSources.length === 0) {
		return null;
	}

	const primaryDisplayId = String(screen.getPrimaryDisplay().id);
	const primarySource =
		screenSources.find((source) => source.display_id === primaryDisplayId) ?? screenSources[0];

	return primarySource ? serializeDesktopSource(primarySource) : null;
}

function normalizePath(filePath: string) {
	return path.resolve(filePath);
}

function normalizeVideoSourcePath(videoPath?: string | null): string | null {
	if (typeof videoPath !== "string") {
		return null;
	}

	const trimmed = videoPath.trim();
	if (!trimmed) {
		return null;
	}

	if (/^file:\/\//i.test(trimmed)) {
		try {
			return fileURLToPath(trimmed);
		} catch {
			// Fall through and keep best-effort string path below.
		}
	}

	return trimmed;
}

function isTrustedProjectPath(filePath?: string | null) {
	if (!filePath || !currentProjectPath) {
		return false;
	}
	return normalizePath(filePath) === normalizePath(currentProjectPath);
}

function setCurrentRecordingSessionState(session: RecordingSession | null) {
	currentRecordingSession = session;
}

function getSessionManifestPathForVideo(videoPath: string) {
	const parsed = path.parse(videoPath);
	const baseName = parsed.name.endsWith("-webcam")
		? parsed.name.slice(0, -"-webcam".length)
		: parsed.name;
	return path.join(parsed.dir, `${baseName}${RECORDING_SESSION_SUFFIX}`);
}

async function loadRecordedSessionForVideoPath(
	videoPath: string,
): Promise<RecordingSession | null> {
	const normalizedVideoPath = normalizeVideoSourcePath(videoPath);
	if (!normalizedVideoPath) {
		return null;
	}

	try {
		const manifestPath = getSessionManifestPathForVideo(normalizedVideoPath);
		const content = await fs.readFile(manifestPath, "utf-8");
		const session = normalizeRecordingSession(JSON.parse(content));
		if (!session) {
			return null;
		}

		const normalizedSession: RecordingSession = {
			...session,
			screenVideoPath: normalizeVideoSourcePath(session.screenVideoPath) ?? session.screenVideoPath,
			...(session.webcamVideoPath
				? {
						webcamVideoPath:
							normalizeVideoSourcePath(session.webcamVideoPath) ?? session.webcamVideoPath,
					}
				: {}),
			...(session.audioPath
				? {
						audioPath: normalizeVideoSourcePath(session.audioPath) ?? session.audioPath,
					}
				: {}),
		};

		const targetPath = normalizePath(normalizedVideoPath);
		const screenMatches = normalizePath(normalizedSession.screenVideoPath) === targetPath;
		const webcamMatches = normalizedSession.webcamVideoPath
			? normalizePath(normalizedSession.webcamVideoPath) === targetPath
			: false;

		return screenMatches || webcamMatches ? normalizedSession : null;
	} catch {
		return null;
	}
}

async function storeRecordedSessionFiles(payload: StoreRecordedSessionInput) {
	const createdAt =
		typeof payload.createdAt === "number" && Number.isFinite(payload.createdAt)
			? payload.createdAt
			: Date.now();
	const screenVideoPath = resolveRecordingOutputPath(payload.screen.fileName);
	await fs.writeFile(screenVideoPath, Buffer.from(payload.screen.videoData));

	let webcamVideoPath: string | undefined;
	if (payload.webcam) {
		webcamVideoPath = resolveRecordingOutputPath(payload.webcam.fileName);
		await fs.writeFile(webcamVideoPath, Buffer.from(payload.webcam.videoData));
	}

	let audioPath: string | undefined;
	if (payload.audio) {
		audioPath = resolveRecordingOutputPath(payload.audio.fileName);
		await fs.writeFile(audioPath, Buffer.from(payload.audio.audioData));
	}

	const session: RecordingSession = {
		screenVideoPath,
		...(webcamVideoPath ? { webcamVideoPath } : {}),
		...(audioPath ? { audioPath } : {}),
		createdAt,
	};
	setCurrentRecordingSessionState(session);
	currentProjectPath = null;

	const telemetryPath = `${screenVideoPath}.cursor.json`;
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples }, null, 2),
			"utf-8",
		);
	}
	pendingCursorSamples = [];

	const sessionManifestPath = path.join(
		RECORDINGS_DIR,
		`${path.parse(payload.screen.fileName).name}${RECORDING_SESSION_SUFFIX}`,
	);
	await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");

	return {
		success: true,
		path: screenVideoPath,
		session,
		message: "Recording session stored successfully",
	};
}

function isFiniteRecordingId(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function createStreamingRecordingAsset(descriptor: { fileName: string }): StreamingRecordingAsset {
	return {
		filePath: resolveRecordingOutputPath(descriptor.fileName),
		queue: Promise.resolve(),
		bytesWritten: 0,
		chunkCount: 0,
	};
}

async function waitForStreamingRecordingWrites(session: StreamingRecordingSession) {
	await Promise.all([
		session.screen.queue,
		session.webcam?.queue ?? Promise.resolve(),
		session.audio?.queue ?? Promise.resolve(),
	]);
}

function getStreamingRecordingAsset(
	session: StreamingRecordingSession,
	kind: RecordingAssetKind,
): StreamingRecordingAsset | null {
	if (kind === "screen") return session.screen;
	if (kind === "webcam") return session.webcam ?? null;
	if (kind === "audio") return session.audio ?? null;
	return null;
}

async function beginStreamingRecordingSession(input: BeginRecordingSessionInput) {
	if (!isFiniteRecordingId(input.recordingId)) {
		throw new Error("Invalid recording id");
	}

	if (streamingRecordingSessions.has(input.recordingId)) {
		await discardStreamingRecordingSession({ recordingId: input.recordingId });
	}

	const createdAt =
		typeof input.createdAt === "number" && Number.isFinite(input.createdAt)
			? input.createdAt
			: input.recordingId;
	const session: StreamingRecordingSession = {
		recordingId: input.recordingId,
		createdAt,
		screen: createStreamingRecordingAsset(input.screen),
		...(input.webcam ? { webcam: createStreamingRecordingAsset(input.webcam) } : {}),
		...(input.audio ? { audio: createStreamingRecordingAsset(input.audio) } : {}),
	};

	await fs.writeFile(session.screen.filePath, "");
	approveFilePath(session.screen.filePath);
	if (session.webcam) {
		await fs.writeFile(session.webcam.filePath, "");
		approveFilePath(session.webcam.filePath);
	}
	if (session.audio) {
		await fs.writeFile(session.audio.filePath, "");
		approveFilePath(session.audio.filePath);
	}

	streamingRecordingSessions.set(input.recordingId, session);
	currentProjectPath = null;

	return {
		success: true,
		path: session.screen.filePath,
		message: "Recording session initialized",
	};
}

async function appendStreamingRecordingChunk(input: AppendRecordingChunkInput) {
	const session = streamingRecordingSessions.get(input.recordingId);
	if (!session) {
		throw new Error("Recording session is not initialized");
	}

	const asset = getStreamingRecordingAsset(session, input.kind);
	if (!asset) {
		throw new Error(`Recording asset is not initialized: ${input.kind}`);
	}

	const chunk = Buffer.from(input.data);
	if (chunk.byteLength === 0) {
		return { success: true, path: asset.filePath, bytesWritten: asset.bytesWritten };
	}

	asset.bytesWritten += chunk.byteLength;
	asset.chunkCount += 1;
	asset.queue = asset.queue.then(() => fs.appendFile(asset.filePath, chunk));
	await asset.queue;

	return { success: true, path: asset.filePath, bytesWritten: asset.bytesWritten };
}

async function replaceStreamingRecordingAsset(input: ReplaceRecordingAssetInput) {
	const session = streamingRecordingSessions.get(input.recordingId);
	if (!session) {
		throw new Error("Recording session is not initialized");
	}

	const asset = getStreamingRecordingAsset(session, input.kind);
	if (!asset) {
		throw new Error(`Recording asset is not initialized: ${input.kind}`);
	}

	const data = Buffer.from(input.data);
	asset.queue = asset.queue.then(async () => {
		await fs.writeFile(asset.filePath, data);
		asset.bytesWritten = data.byteLength;
		asset.chunkCount = Math.max(asset.chunkCount, 1);
	});
	await asset.queue;

	return { success: true, path: asset.filePath, bytesWritten: asset.bytesWritten };
}

async function finishStreamingRecordingSession(input: FinishRecordingSessionInput) {
	const sessionState = streamingRecordingSessions.get(input.recordingId);
	if (!sessionState) {
		throw new Error("Recording session is not initialized");
	}

	await waitForStreamingRecordingWrites(sessionState);
	if (sessionState.screen.bytesWritten <= 0) {
		throw new Error("Recording session has no screen data");
	}

	const session: RecordingSession = {
		screenVideoPath: sessionState.screen.filePath,
		...(sessionState.webcam && sessionState.webcam.bytesWritten > 0
			? { webcamVideoPath: sessionState.webcam.filePath }
			: {}),
		...(sessionState.audio && sessionState.audio.bytesWritten > 0
			? { audioPath: sessionState.audio.filePath }
			: {}),
		createdAt: sessionState.createdAt,
	};

	setCurrentRecordingSessionState(session);
	currentProjectPath = null;

	const telemetryPath = `${session.screenVideoPath}.cursor.json`;
	if (pendingCursorSamples.length > 0) {
		await fs.writeFile(
			telemetryPath,
			JSON.stringify({ version: CURSOR_TELEMETRY_VERSION, samples: pendingCursorSamples }, null, 2),
			"utf-8",
		);
	}
	pendingCursorSamples = [];

	const sessionManifestPath = getSessionManifestPathForVideo(session.screenVideoPath);
	await fs.writeFile(sessionManifestPath, JSON.stringify(session, null, 2), "utf-8");
	streamingRecordingSessions.delete(input.recordingId);

	return {
		success: true,
		path: session.screenVideoPath,
		session,
		message: "Recording session finalized",
	};
}

async function discardStreamingRecordingSession(input: DiscardRecordingSessionInput) {
	const session = streamingRecordingSessions.get(input.recordingId);
	if (!session) {
		return { success: true };
	}

	streamingRecordingSessions.delete(input.recordingId);
	pendingCursorSamples = [];
	await waitForStreamingRecordingWrites(session).catch(() => undefined);
	await Promise.all(
		[session.screen, session.webcam, session.audio].filter(Boolean).map(async (asset) => {
			await fs
				.rm((asset as StreamingRecordingAsset).filePath, { force: true })
				.catch(() => undefined);
		}),
	);
	await fs
		.rm(getSessionManifestPathForVideo(session.screen.filePath), { force: true })
		.catch(() => undefined);

	return { success: true };
}

const CURSOR_TELEMETRY_VERSION = 1;
const CURSOR_SAMPLE_INTERVAL_MS = 100;
const MAX_CURSOR_SAMPLES = 60 * 60 * 10; // 1 hour @ 10Hz

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}

let cursorCaptureInterval: NodeJS.Timeout | null = null;
let cursorCaptureStartTimeMs = 0;
let activeCursorSamples: CursorTelemetryPoint[] = [];
let pendingCursorSamples: CursorTelemetryPoint[] = [];

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}

function stopCursorCapture() {
	if (cursorCaptureInterval) {
		clearInterval(cursorCaptureInterval);
		cursorCaptureInterval = null;
	}
}

function sampleCursorPoint() {
	const cursor = screen.getCursorScreenPoint();
	const sourceDisplayId = Number(selectedSource?.display_id);
	const sourceDisplay = Number.isFinite(sourceDisplayId)
		? (screen.getAllDisplays().find((display) => display.id === sourceDisplayId) ?? null)
		: null;
	const display = sourceDisplay ?? screen.getDisplayNearestPoint(cursor);
	const bounds = display.bounds;
	const width = Math.max(1, bounds.width);
	const height = Math.max(1, bounds.height);

	const cx = clamp((cursor.x - bounds.x) / width, 0, 1);
	const cy = clamp((cursor.y - bounds.y) / height, 0, 1);

	activeCursorSamples.push({
		timeMs: Math.max(0, Date.now() - cursorCaptureStartTimeMs),
		cx,
		cy,
	});

	if (activeCursorSamples.length > MAX_CURSOR_SAMPLES) {
		activeCursorSamples.shift();
	}
}

export function registerIpcHandlers(
	createEditorWindow: () => void,
	createSourceSelectorWindow: () => BrowserWindow,
	createCountdownOverlayWindow: () => BrowserWindow,
	getMainWindow: () => BrowserWindow | null,
	getSourceSelectorWindow: () => BrowserWindow | null,
	getCountdownOverlayWindow: () => BrowserWindow | null,
	onRecordingStateChange?: (recording: boolean, sourceName: string) => void,
	switchToHud?: () => void,
) {
	const supportsWindowOpacity = process.platform !== "linux";
	const countdownOverlayState = {
		visible: false,
		value: null as number | null,
		activeRunId: null as number | null,
		hideCommitId: 0,
		hideCommitTimer: null as ReturnType<typeof setTimeout> | null,
	};
	const COUNTDOWN_OVERLAY_HIDE_DEBOUNCE_MS = 1200;

	const clearCountdownOverlayHideCommit = () => {
		if (countdownOverlayState.hideCommitTimer) {
			clearTimeout(countdownOverlayState.hideCommitTimer);
			countdownOverlayState.hideCommitTimer = null;
		}
	};

	const commitCountdownOverlayHide = (win: BrowserWindow, hideCommitId: number) => {
		if (win.isDestroyed()) {
			return;
		}

		if (countdownOverlayState.visible || countdownOverlayState.hideCommitId !== hideCommitId) {
			return;
		}

		win.hide();
		if (supportsWindowOpacity) {
			// Reset baseline opacity for the next show cycle.
			win.setOpacity(1);
		}
	};

	const flushCountdownOverlayState = (win: BrowserWindow) => {
		if (win.isDestroyed()) {
			return;
		}

		clearCountdownOverlayHideCommit();
		win.webContents.send("countdown-overlay-value", countdownOverlayState.value);
		if (!countdownOverlayState.visible) {
			return;
		}

		if (win.isVisible()) {
			if (supportsWindowOpacity) {
				win.setOpacity(1);
			}
			return;
		}

		setTimeout(() => {
			if (!win.isDestroyed() && countdownOverlayState.visible && !win.isVisible()) {
				if (supportsWindowOpacity) {
					win.setOpacity(0);
				}
				win.showInactive();

				if (supportsWindowOpacity) {
					setTimeout(() => {
						if (!win.isDestroyed() && countdownOverlayState.visible && win.isVisible()) {
							win.setOpacity(1);
						}
					}, 0);
				}
			}
		}, 16);
	};

	ipcMain.handle("countdown-overlay-show", (_, value: number, runId: number) => {
		countdownOverlayState.activeRunId = runId;
		countdownOverlayState.visible = true;
		countdownOverlayState.value = value;

		const win = getCountdownOverlayWindow() ?? createCountdownOverlayWindow();
		if (win.isDestroyed()) {
			return;
		}

		if (win.webContents.isLoading()) {
			win.webContents.once("did-finish-load", () => {
				if (!win.isDestroyed()) {
					flushCountdownOverlayState(win);
				}
			});
		} else {
			flushCountdownOverlayState(win);
		}
	});

	ipcMain.handle("countdown-overlay-set-value", (_, value: number, runId: number) => {
		if (countdownOverlayState.activeRunId !== runId || !countdownOverlayState.visible) {
			return;
		}

		countdownOverlayState.value = value;

		const win = getCountdownOverlayWindow();
		if (!win || win.isDestroyed()) {
			return;
		}

		if (win.webContents.isLoading()) {
			return;
		}

		win.webContents.send("countdown-overlay-value", value);
	});

	ipcMain.handle("countdown-overlay-hide", (_, runId: number) => {
		if (countdownOverlayState.activeRunId !== runId) {
			return;
		}

		countdownOverlayState.visible = false;
		countdownOverlayState.hideCommitId += 1;
		const hideCommitId = countdownOverlayState.hideCommitId;
		clearCountdownOverlayHideCommit();

		const win = getCountdownOverlayWindow();
		if (!win || win.isDestroyed()) {
			countdownOverlayState.value = null;
			return;
		}

		if (supportsWindowOpacity) {
			// Hide visually immediately to avoid hide/show compositor flashes on rapid restart.
			win.setOpacity(0);
		}

		countdownOverlayState.value = null;
		if (!win.webContents.isLoading()) {
			win.webContents.send("countdown-overlay-value", countdownOverlayState.value);
		}

		if (!supportsWindowOpacity) {
			win.hide();
			return;
		}

		countdownOverlayState.hideCommitTimer = setTimeout(() => {
			countdownOverlayState.hideCommitTimer = null;
			commitCountdownOverlayHide(win, hideCommitId);
		}, COUNTDOWN_OVERLAY_HIDE_DEBOUNCE_MS);
	});

	ipcMain.handle("switch-to-hud", () => {
		if (switchToHud) switchToHud();
	});
	ipcMain.handle("start-new-recording", () => {
		try {
			setCurrentRecordingSessionState(null);
			if (switchToHud) {
				switchToHud();
			}
			return { success: true };
		} catch (error) {
			console.error("Failed to start new recording:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-sources", async (_, opts) => {
		const sources = await desktopCapturer.getSources(opts);
		return sources.map(serializeDesktopSource);
	});

	ipcMain.handle("get-screen-capture-access", () => getScreenCaptureAccessState());

	ipcMain.handle("select-source", (_, source: unknown) => {
		selectedSource = normalizeSelectedSource(source);
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.close();
		}
		return selectedSource;
	});

	ipcMain.handle("select-default-source", async () => {
		selectedSource = await getPrimaryScreenSource();
		return selectedSource;
	});

	ipcMain.handle("open-screen-capture-settings", async () => {
		if (process.platform !== "darwin") {
			return {
				success: false,
				error: "Screen capture settings shortcut is only supported on macOS",
			};
		}

		try {
			await shell.openExternal(
				"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
			);
			return { success: true };
		} catch (error) {
			console.error("Failed to open screen capture settings:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("get-selected-source", () => {
		return selectedSource;
	});

	ipcMain.handle("request-camera-access", async () => {
		if (process.platform !== "darwin") {
			return { success: true, granted: true, status: "granted" };
		}

		try {
			const status = systemPreferences.getMediaAccessStatus("camera");
			if (status === "granted") {
				return { success: true, granted: true, status };
			}

			if (status === "not-determined") {
				const granted = await systemPreferences.askForMediaAccess("camera");
				return {
					success: true,
					granted,
					status: granted ? "granted" : systemPreferences.getMediaAccessStatus("camera"),
				};
			}

			return { success: true, granted: false, status };
		} catch (error) {
			console.error("Failed to request camera access:", error);
			return {
				success: false,
				granted: false,
				status: "unknown",
				error: String(error),
			};
		}
	});

	ipcMain.handle("open-source-selector", () => {
		const sourceSelectorWin = getSourceSelectorWindow();
		if (sourceSelectorWin) {
			sourceSelectorWin.focus();
			return;
		}
		createSourceSelectorWindow();
	});

	ipcMain.handle("minimize-current-window", (event) => {
		const targetWindow = BrowserWindow.fromWebContents(event.sender);
		if (!targetWindow) {
			return { success: false, error: "Window not found" };
		}

		targetWindow.minimize();
		return { success: true };
	});

	ipcMain.handle("close-current-window", (event) => {
		const targetWindow = BrowserWindow.fromWebContents(event.sender);
		if (!targetWindow) {
			return { success: false, error: "Window not found" };
		}

		targetWindow.close();
		return { success: true };
	});

	ipcMain.handle("restart-app", () => {
		setImmediate(() => {
			app.relaunch();
			app.exit(0);
		});
		return { success: true };
	});

	ipcMain.handle("set-current-window-size", (event, width: number, height: number) => {
		const targetWindow = BrowserWindow.fromWebContents(event.sender);
		if (!targetWindow) {
			return { success: false, error: "Window not found" };
		}

		const nextWidth = Math.max(320, Math.round(width));
		const nextHeight = Math.max(120, Math.round(height));
		targetWindow.setSize(nextWidth, nextHeight, true);
		targetWindow.center();
		return { success: true };
	});

	ipcMain.handle("switch-to-editor", () => {
		const mainWin = getMainWindow();
		if (mainWin) {
			mainWin.close();
		}
		createEditorWindow();
	});

	ipcMain.handle("store-recorded-session", async (_, payload: StoreRecordedSessionInput) => {
		try {
			return await storeRecordedSessionFiles(payload);
		} catch (error) {
			console.error("Failed to store recording session:", error);
			return {
				success: false,
				message: "Failed to store recording session",
				error: String(error),
			};
		}
	});

	ipcMain.handle("begin-recording-session", async (_, input: BeginRecordingSessionInput) => {
		try {
			return await beginStreamingRecordingSession(input);
		} catch (error) {
			console.error("Failed to begin recording session:", error);
			return {
				success: false,
				message: "Failed to begin recording session",
				error: String(error),
			};
		}
	});

	ipcMain.handle("append-recording-chunk", async (_, input: AppendRecordingChunkInput) => {
		try {
			return await appendStreamingRecordingChunk(input);
		} catch (error) {
			console.error("Failed to append recording chunk:", error);
			return {
				success: false,
				message: "Failed to append recording chunk",
				error: String(error),
			};
		}
	});

	ipcMain.handle("replace-recording-asset", async (_, input: ReplaceRecordingAssetInput) => {
		try {
			return await replaceStreamingRecordingAsset(input);
		} catch (error) {
			console.error("Failed to replace recording asset:", error);
			return {
				success: false,
				message: "Failed to replace recording asset",
				error: String(error),
			};
		}
	});

	ipcMain.handle("finish-recording-session", async (_, input: FinishRecordingSessionInput) => {
		try {
			return await finishStreamingRecordingSession(input);
		} catch (error) {
			console.error("Failed to finish recording session:", error);
			return {
				success: false,
				message: "Failed to finish recording session",
				error: String(error),
			};
		}
	});

	ipcMain.handle("discard-recording-session", async (_, input: DiscardRecordingSessionInput) => {
		try {
			return await discardStreamingRecordingSession(input);
		} catch (error) {
			console.error("Failed to discard recording session:", error);
			return {
				success: false,
				message: "Failed to discard recording session",
				error: String(error),
			};
		}
	});

	ipcMain.handle("store-recorded-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			return await storeRecordedSessionFiles({
				screen: { videoData, fileName },
				createdAt: Date.now(),
			});
		} catch (error) {
			console.error("Failed to store recorded video:", error);
			return {
				success: false,
				message: "Failed to store recorded video",
				error: String(error),
			};
		}
	});

	ipcMain.handle("get-recorded-video-path", async () => {
		try {
			if (currentRecordingSession?.screenVideoPath) {
				return { success: true, path: currentRecordingSession.screenVideoPath };
			}

			const files = await fs.readdir(RECORDINGS_DIR);
			const videoFiles = files.filter(
				(file) => file.endsWith(".webm") && !file.endsWith("-webcam.webm"),
			);

			if (videoFiles.length === 0) {
				return { success: false, message: "No recorded video found" };
			}

			// Sort by most recently modified to reliably get the latest recording.
			// Lexicographic sort is unreliable (e.g. recording-9.webm > recording-10.webm).
			let latestVideo: string | null = null;
			let latestMtimeMs = 0;
			for (const file of videoFiles) {
				try {
					const stat = await fs.stat(path.join(RECORDINGS_DIR, file));
					if (stat.mtimeMs > latestMtimeMs) {
						latestMtimeMs = stat.mtimeMs;
						latestVideo = file;
					}
				} catch {
					// Skip inaccessible files.
				}
			}
			if (!latestVideo) {
				return { success: false, message: "No recorded video found" };
			}
			const videoPath = path.join(RECORDINGS_DIR, latestVideo);

			return { success: true, path: videoPath };
		} catch (error) {
			console.error("Failed to get video path:", error);
			return {
				success: false,
				message: "Failed to get video path",
				error: String(error),
			};
		}
	});

	ipcMain.handle("read-binary-file", async (_, inputPath: string) => {
		try {
			const normalizedPath = normalizeVideoSourcePath(inputPath);
			if (!normalizedPath) {
				return { success: false, message: "Invalid file path" };
			}

			if (!isPathAllowed(normalizedPath)) {
				console.warn(
					"[read-binary-file] Rejected path outside allowed directories:",
					normalizedPath,
				);
				return {
					success: false,
					message: "Access denied: path outside allowed directories",
				};
			}

			const data = await fs.readFile(normalizedPath);
			return {
				success: true,
				data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
				path: normalizedPath,
			};
		} catch (error) {
			console.error("Failed to read binary file:", error);
			return {
				success: false,
				message: "Failed to read binary file",
				error: String(error),
			};
		}
	});

	ipcMain.handle("set-recording-state", (_, recording: boolean) => {
		if (recording) {
			stopCursorCapture();
			activeCursorSamples = [];
			pendingCursorSamples = [];
			cursorCaptureStartTimeMs = Date.now();
			sampleCursorPoint();
			cursorCaptureInterval = setInterval(sampleCursorPoint, CURSOR_SAMPLE_INTERVAL_MS);
		} else {
			stopCursorCapture();
			pendingCursorSamples = [...activeCursorSamples];
			activeCursorSamples = [];
		}

		const source = selectedSource || { name: "Screen" };
		if (onRecordingStateChange) {
			onRecordingStateChange(recording, source.name);
		}
	});

	ipcMain.handle("get-cursor-telemetry", async (_, videoPath?: string) => {
		const targetVideoPath = normalizeVideoSourcePath(
			videoPath ?? currentRecordingSession?.screenVideoPath,
		);
		if (!targetVideoPath) {
			return { success: true, samples: [] };
		}

		if (!isPathAllowed(targetVideoPath)) {
			console.warn(
				"[get-cursor-telemetry] Rejected path outside allowed directories:",
				targetVideoPath,
			);
			return { success: true, samples: [] };
		}

		const telemetryPath = `${targetVideoPath}.cursor.json`;
		try {
			const content = await fs.readFile(telemetryPath, "utf-8");
			const parsed = JSON.parse(content);
			const rawSamples = Array.isArray(parsed)
				? parsed
				: Array.isArray(parsed?.samples)
					? parsed.samples
					: [];

			const samples: CursorTelemetryPoint[] = rawSamples
				.filter((sample: unknown) => Boolean(sample && typeof sample === "object"))
				.map((sample: unknown) => {
					const point = sample as Partial<CursorTelemetryPoint>;
					return {
						timeMs:
							typeof point.timeMs === "number" && Number.isFinite(point.timeMs)
								? Math.max(0, point.timeMs)
								: 0,
						cx:
							typeof point.cx === "number" && Number.isFinite(point.cx)
								? clamp(point.cx, 0, 1)
								: 0.5,
						cy:
							typeof point.cy === "number" && Number.isFinite(point.cy)
								? clamp(point.cy, 0, 1)
								: 0.5,
					};
				})
				.sort((a: CursorTelemetryPoint, b: CursorTelemetryPoint) => a.timeMs - b.timeMs);

			return { success: true, samples };
		} catch (error) {
			const nodeError = error as NodeJS.ErrnoException;
			if (nodeError.code === "ENOENT") {
				return { success: true, samples: [] };
			}
			console.error("Failed to load cursor telemetry:", error);
			return {
				success: false,
				message: "Failed to load cursor telemetry",
				error: String(error),
				samples: [],
			};
		}
	});

	ipcMain.handle("docsie:get-state", async () => {
		try {
			return { success: true, state: await getDocsieIntegrationState() };
		} catch (error) {
			console.error("Failed to read Docsie integration state:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("docsie:save-config", async (_, input: DocsieIntegrationConfigInput) => {
		try {
			return {
				success: true,
				state: await saveDocsieIntegrationConfig(input),
			};
		} catch (error) {
			console.error("Failed to save Docsie integration config:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle("docsie:list-workspaces", async () => {
		try {
			return { success: true, workspaces: await listDocsieWorkspaces() };
		} catch (error) {
			console.error("Failed to list Docsie workspaces:", error);
			return { success: false, error: String(error), workspaces: [] };
		}
	});

	ipcMain.handle(
		"docsie:list-documentation-shelves",
		async (_, input: DocsieListDocumentationShelvesInput) => {
			try {
				return {
					success: true,
					shelves: await listDocsieDocumentationShelves(input),
				};
			} catch (error) {
				console.error("Failed to list Docsie shelves:", error);
				return { success: false, error: String(error), shelves: [] };
			}
		},
	);

	ipcMain.handle("docsie:list-generation-templates", async () => {
		try {
			return {
				success: true,
				templates: await listDocsieGenerationTemplates(),
			};
		} catch (error) {
			console.error("Failed to list Docsie generation templates:", error);
			return { success: false, error: String(error), templates: [] };
		}
	});

	ipcMain.handle("docsie:list-voice-options", async (_, input: DocsieListVoiceOptionsInput) => {
		return await listDocsieVoiceOptions(input ?? {});
	});

	ipcMain.handle("docsie:list-transcription-options", async () => {
		return await listDocsieTranscriptionOptions();
	});

	ipcMain.handle("docsie:transcribe-audio", async (_, input: DocsieTranscribeAudioInput) => {
		try {
			if (input.audioPath && !input.audioData) {
				const approvedAudioPath = await approveReadableVideoPath(input.audioPath);
				if (!approvedAudioPath) {
					return {
						success: false,
						segments: [],
						error: "Selected audio is not readable or is outside approved locations",
					};
				}

				const audioBuffer = await fs.readFile(approvedAudioPath);
				return await transcribeDocsieAudio({
					...input,
					audioPath: undefined,
					audioData: audioBuffer.buffer.slice(
						audioBuffer.byteOffset,
						audioBuffer.byteOffset + audioBuffer.byteLength,
					),
					fileName: input.fileName || path.basename(approvedAudioPath),
					contentType: input.contentType || "audio/webm",
				});
			}

			return await transcribeDocsieAudio(input);
		} catch (error) {
			console.error("Failed to transcribe Docsie audio:", error);
			return {
				success: false,
				segments: [],
				error: error instanceof Error ? error.message : String(error),
			};
		}
	});

	ipcMain.handle("docsie:generate-voiceover", async (_, input: DocsieGenerateVoiceoverInput) => {
		return await generateDocsieVoiceover(input);
	});

	ipcMain.handle("docsie:estimate-video-to-docs", async (_, input: DocsieEstimateInput) => {
		return await estimateDocsieVideoToDocs(input);
	});

	ipcMain.handle("docsie:get-credit-balance", async () => {
		return await getDocsieCreditBalance();
	});

	ipcMain.handle("docsie:start-video-to-docs", async (_, input: DocsieStartVideoToDocsInput) => {
		try {
			const approvedVideoPath = await approveReadableVideoPath(input.videoPath);
			if (!approvedVideoPath) {
				return {
					success: false,
					error: "Selected video is not readable or is outside approved locations",
				};
			}

			return await startDocsieVideoToDocs({
				...input,
				videoPath: approvedVideoPath,
			});
		} catch (error) {
			console.error("Failed to start Docsie video-to-docs job:", error);
			return { success: false, error: String(error) };
		}
	});

	ipcMain.handle(
		"docsie:generate-video-to-docs",
		async (_, input: DocsieGenerateVideoToDocsInput) => {
			try {
				return await generateDocsieVideoToDocs(input);
			} catch (error) {
				console.error("Failed to generate Docsie documentation:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("docsie:get-job-status", async (_, jobId: string) => {
		return await getDocsieVideoToDocsJobStatus(jobId);
	});

	ipcMain.handle("docsie:get-job-result", async (_, jobId: string) => {
		return await getDocsieVideoToDocsJobResult(jobId);
	});

	ipcMain.handle("docsie:get-background-job", async (_, jobId: string) => {
		return await getDocsieBackgroundJob(jobId);
	});

	ipcMain.handle("docsie:list-video-to-docs-history", async (_, videoPath: string) => {
		try {
			const approvedVideoPath = await approveReadableVideoPath(videoPath);
			if (!approvedVideoPath) {
				return {
					success: false,
					error: "Selected video is not readable",
					entries: [],
				};
			}

			return {
				success: true,
				entries: await listDocsieVideoToDocsHistory(approvedVideoPath),
			};
		} catch (error) {
			console.error("Failed to list Docsie video-to-docs history:", error);
			return { success: false, error: String(error), entries: [] };
		}
	});

	ipcMain.handle(
		"docsie:save-video-to-docs-history",
		async (_, input: DocsieSaveVideoToDocsHistoryInput) => {
			try {
				const approvedVideoPath = await approveReadableVideoPath(input.videoPath);
				if (!approvedVideoPath) {
					return {
						success: false,
						error: "Selected video is not readable",
					};
				}

				return {
					success: true,
					entry: await saveDocsieVideoToDocsHistory({
						...input,
						videoPath: approvedVideoPath,
					}),
				};
			} catch (error) {
				console.error("Failed to save Docsie video-to-docs history:", error);
				return { success: false, error: String(error) };
			}
		},
	);

	ipcMain.handle("open-external-url", async (_, url: string) => {
		try {
			const ALLOWED_SCHEMES = ["http:", "https:", "mailto:"];
			let parsed: URL;
			try {
				parsed = new URL(url);
			} catch {
				return { success: false, error: "Invalid URL" };
			}

			if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
				return {
					success: false,
					error: `Unsupported URL scheme: ${parsed.protocol}`,
				};
			}

			await shell.openExternal(parsed.toString());
			return { success: true };
		} catch (error) {
			console.error("Failed to open URL:", error);
			return { success: false, error: String(error) };
		}
	});

	// Return base path for assets so renderer can resolve file:// paths in production
	ipcMain.handle("get-asset-base-path", () => {
		try {
			if (app.isPackaged) {
				const assetPath = path.join(process.resourcesPath, "assets");
				return pathToFileURL(`${assetPath}${path.sep}`).toString();
			}
			const assetPath = path.join(app.getAppPath(), "public", "assets");
			return pathToFileURL(`${assetPath}${path.sep}`).toString();
		} catch (err) {
			console.error("Failed to resolve asset base path:", err);
			return null;
		}
	});

	/**
	 * Handles saving an exported video file.
	 * Shows a save dialog, normalizes the file path for the current OS,
	 * ensures the directory exists, and writes the video data.
	 * @param _ - Unused event parameter.
	 * @param videoData - The exported video as an ArrayBuffer.
	 * @param fileName - Suggested filename for the save dialog.
	 * @returns Object with success status, optional file path, and error details.
	 */

	ipcMain.handle("save-exported-video", async (_, videoData: ArrayBuffer, fileName: string) => {
		try {
			// Determine file type from extension
			const isGif = fileName.toLowerCase().endsWith(".gif");
			const filters = isGif
				? [
						{
							name: mainT("dialogs", "fileDialogs.gifImage"),
							extensions: ["gif"],
						},
					]
				: [
						{
							name: mainT("dialogs", "fileDialogs.mp4Video"),
							extensions: ["mp4"],
						},
					];

			const result = await dialog.showSaveDialog({
				title: isGif
					? mainT("dialogs", "fileDialogs.saveGif")
					: mainT("dialogs", "fileDialogs.saveVideo"),
				defaultPath: path.join(app.getPath("downloads"), fileName),
				filters,
				properties: ["createDirectory", "showOverwriteConfirmation"],
			});

			if (result.canceled || !result.filePath) {
				return {
					success: false,
					canceled: true,
					message: "Export canceled",
				};
			}

			// --- FIX: Normalize the path for Windows compatibility ---
			const normalizedPath = path.normalize(result.filePath);

			// Ensure the parent directory exists (Windows may fail if the folder is missing)
			await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
			// --- END FIX ---

			await fs.writeFile(normalizedPath, Buffer.from(videoData));

			return {
				success: true,
				path: normalizedPath,
				message: "Video exported successfully",
			};
		} catch (error) {
			console.error("Failed to save exported video:", error);
			return {
				success: false,
				message: "Failed to save exported video",
				error: String(error),
			};
		}
	});

	ipcMain.handle(
		"save-text-file",
		async (
			_,
			textContent: string,
			fileName: string,
			filters?: Array<{ name: string; extensions: string[] }>,
		) => {
			try {
				const result = await dialog.showSaveDialog({
					title: "Save File",
					defaultPath: path.join(app.getPath("downloads"), fileName),
					filters:
						Array.isArray(filters) && filters.length > 0
							? filters
							: [{ name: "Text Files", extensions: ["txt"] }],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Save canceled",
					};
				}

				const normalizedPath = path.normalize(result.filePath);
				await fs.mkdir(path.dirname(normalizedPath), { recursive: true });
				await fs.writeFile(normalizedPath, textContent, "utf-8");

				return {
					success: true,
					path: normalizedPath,
					message: "File saved successfully",
				};
			} catch (error) {
				console.error("Failed to save text file:", error);
				return {
					success: false,
					message: "Failed to save file",
					error: String(error),
				};
			}
		},
	);
	ipcMain.handle("open-video-file-picker", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: mainT("dialogs", "fileDialogs.selectVideo"),
				defaultPath: RECORDINGS_DIR,
				filters: [
					{
						name: mainT("dialogs", "fileDialogs.videoFiles"),
						extensions: ["webm", "mp4", "mov", "avi", "mkv"],
					},
					{ name: mainT("dialogs", "fileDialogs.allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return { success: false, canceled: true };
			}

			const approvedPath = await approveReadableVideoPath(result.filePaths[0]);
			if (!approvedPath) {
				return {
					success: false,
					message: "Selected file is not a supported video",
				};
			}
			currentProjectPath = null;
			return {
				success: true,
				path: approvedPath,
			};
		} catch (error) {
			console.error("Failed to open file picker:", error);
			return {
				success: false,
				message: "Failed to open file picker",
				error: String(error),
			};
		}
	});

	ipcMain.handle("reveal-in-folder", async (_, filePath: string) => {
		try {
			// shell.showItemInFolder doesn't return a value, it throws on error
			shell.showItemInFolder(filePath);
			return { success: true };
		} catch (error) {
			console.error(`Error revealing item in folder: ${filePath}`, error);
			// Fallback to open the directory if revealing the item fails
			// This might happen if the file was moved or deleted after export,
			// or if the path is somehow invalid for showItemInFolder
			try {
				const openPathResult = await shell.openPath(path.dirname(filePath));
				if (openPathResult) {
					// openPath returned an error message
					return { success: false, error: openPathResult };
				}
				return {
					success: true,
					message: "Could not reveal item, but opened directory.",
				};
			} catch (openError) {
				console.error(`Error opening directory: ${path.dirname(filePath)}`, openError);
				return { success: false, error: String(error) };
			}
		}
	});

	ipcMain.handle(
		"save-project-file",
		async (_, projectData: unknown, suggestedName?: string, existingProjectPath?: string) => {
			try {
				const trustedExistingProjectPath = isTrustedProjectPath(existingProjectPath)
					? existingProjectPath
					: null;

				if (trustedExistingProjectPath) {
					await fs.writeFile(
						trustedExistingProjectPath,
						JSON.stringify(projectData, null, 2),
						"utf-8",
					);
					currentProjectPath = trustedExistingProjectPath;
					return {
						success: true,
						path: trustedExistingProjectPath,
						message: "Project saved successfully",
					};
				}

				const safeName = (suggestedName || `project-${Date.now()}`).replace(/[^a-zA-Z0-9-_]/g, "_");
				const defaultName = safeName.endsWith(`.${PROJECT_FILE_EXTENSION}`)
					? safeName
					: `${safeName}.${PROJECT_FILE_EXTENSION}`;

				const result = await dialog.showSaveDialog({
					title: mainT("dialogs", "fileDialogs.saveProject"),
					defaultPath: path.join(RECORDINGS_DIR, defaultName),
					filters: [
						{
							name: mainT("dialogs", "fileDialogs.openscreenProject"),
							extensions: [PROJECT_FILE_EXTENSION],
						},
						{ name: "JSON", extensions: ["json"] },
					],
					properties: ["createDirectory", "showOverwriteConfirmation"],
				});

				if (result.canceled || !result.filePath) {
					return {
						success: false,
						canceled: true,
						message: "Save project canceled",
					};
				}

				await fs.writeFile(result.filePath, JSON.stringify(projectData, null, 2), "utf-8");
				currentProjectPath = result.filePath;

				return {
					success: true,
					path: result.filePath,
					message: "Project saved successfully",
				};
			} catch (error) {
				console.error("Failed to save project file:", error);
				return {
					success: false,
					message: "Failed to save project file",
					error: String(error),
				};
			}
		},
	);

	ipcMain.handle("load-project-file", async () => {
		try {
			const result = await dialog.showOpenDialog({
				title: mainT("dialogs", "fileDialogs.openProject"),
				defaultPath: RECORDINGS_DIR,
				filters: [
					{
						name: mainT("dialogs", "fileDialogs.openscreenProject"),
						extensions: [PROJECT_FILE_EXTENSION],
					},
					{ name: "JSON", extensions: ["json"] },
					{ name: mainT("dialogs", "fileDialogs.allFiles"), extensions: ["*"] },
				],
				properties: ["openFile"],
			});

			if (result.canceled || result.filePaths.length === 0) {
				return {
					success: false,
					canceled: true,
					message: "Open project canceled",
				};
			}

			const filePath = result.filePaths[0];
			const content = await fs.readFile(filePath, "utf-8");
			const project = JSON.parse(content);
			const session = await getApprovedProjectSession(project, filePath);
			currentProjectPath = filePath;
			setCurrentRecordingSessionState(session);

			return {
				success: true,
				path: filePath,
				project,
			};
		} catch (error) {
			console.error("Failed to load project file:", error);
			return {
				success: false,
				message: "Failed to load project file",
				error: String(error),
			};
		}
	});

	ipcMain.handle("load-current-project-file", async () => {
		try {
			if (!currentProjectPath) {
				return { success: false, message: "No active project" };
			}

			const content = await fs.readFile(currentProjectPath, "utf-8");
			const project = JSON.parse(content);
			const session = await getApprovedProjectSession(project, currentProjectPath);
			setCurrentRecordingSessionState(session);
			return {
				success: true,
				path: currentProjectPath,
				project,
			};
		} catch (error) {
			console.error("Failed to load current project file:", error);
			return {
				success: false,
				message: "Failed to load current project file",
				error: String(error),
			};
		}
	});
	ipcMain.handle("set-current-recording-session", (_, session: RecordingSession | null) => {
		const normalized = normalizeRecordingSession(session);
		setCurrentRecordingSessionState(normalized);
		currentProjectPath = null;
		return { success: true, session: normalized ?? undefined };
	});

	ipcMain.handle("get-current-recording-session", () => {
		return currentRecordingSession
			? { success: true, session: currentRecordingSession }
			: { success: false };
	});

	ipcMain.handle("set-current-video-path", async (_, path: string) => {
		const normalizedPath = normalizeVideoSourcePath(path);
		if (!normalizedPath || !isPathAllowed(normalizedPath)) {
			return { success: false, message: "Video path has not been approved" };
		}

		const restoredSession = await loadRecordedSessionForVideoPath(normalizedPath);
		if (restoredSession) {
			// Approve all media paths from the restored session so they can be read later
			approveFilePath(restoredSession.screenVideoPath);
			if (restoredSession.webcamVideoPath) {
				approveFilePath(restoredSession.webcamVideoPath);
			}
			if (restoredSession.audioPath) {
				approveFilePath(restoredSession.audioPath);
			}
			setCurrentRecordingSessionState(restoredSession);
		} else {
			setCurrentRecordingSessionState({
				screenVideoPath: normalizedPath,
				createdAt: Date.now(),
			});
		}
		currentProjectPath = null;
		return { success: true };
	});

	ipcMain.handle("get-current-video-path", () => {
		return currentRecordingSession?.screenVideoPath
			? { success: true, path: currentRecordingSession.screenVideoPath }
			: { success: false };
	});

	ipcMain.handle("clear-current-video-path", () => {
		setCurrentRecordingSessionState(null);
		return { success: true };
	});

	ipcMain.handle("get-platform", () => {
		return process.platform;
	});

	ipcMain.handle("get-shortcuts", async () => {
		try {
			const data = await fs.readFile(SHORTCUTS_FILE, "utf-8");
			return JSON.parse(data);
		} catch {
			return null;
		}
	});

	ipcMain.handle("save-shortcuts", async (_, shortcuts: unknown) => {
		try {
			await fs.writeFile(SHORTCUTS_FILE, JSON.stringify(shortcuts, null, 2), "utf-8");
			return { success: true };
		} catch (error) {
			console.error("Failed to save shortcuts:", error);
			return { success: false, error: String(error) };
		}
	});
}
