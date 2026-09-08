import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import type { ProgressInfo, UpdateInfo } from "electron-updater";
import { autoUpdater } from "electron-updater";

const RELEASES_API_URL =
	"https://api.github.com/repos/LikaloLLC/docsie-screen-recorder/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/LikaloLLC/docsie-screen-recorder/releases/latest";
const UPDATE_STATE_PATH = path.join(app.getPath("userData"), "update-check.json");
const REQUEST_TIMEOUT_MS = 8000;

interface GitHubReleaseAsset {
	name?: unknown;
	browser_download_url?: unknown;
}

interface GitHubRelease {
	tag_name?: unknown;
	name?: unknown;
	html_url?: unknown;
	body?: unknown;
	assets?: unknown;
}

interface UpdateCheckState {
	skippedVersion?: string;
}

interface BrowserUpdateInfo {
	version: string;
	name: string;
	pageUrl: string;
	downloadUrl: string;
}

interface NativeUpdateInfo {
	version: string;
	name: string;
}

function showNativeMessageBox(
	parent: BrowserWindow | undefined,
	options: Electron.MessageBoxOptions,
) {
	return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function normalizeVersion(value: string) {
	return value.trim().replace(/^v/i, "");
}

function parseVersion(value: string) {
	return normalizeVersion(value)
		.split(/[.-]/)
		.map((part) => Number.parseInt(part, 10))
		.map((part) => (Number.isFinite(part) ? part : 0));
}

function isNewerVersion(candidate: string, current: string) {
	const candidateParts = parseVersion(candidate);
	const currentParts = parseVersion(current);
	const length = Math.max(candidateParts.length, currentParts.length);

	for (let index = 0; index < length; index += 1) {
		const next = candidateParts[index] ?? 0;
		const installed = currentParts[index] ?? 0;
		if (next > installed) {
			return true;
		}
		if (next < installed) {
			return false;
		}
	}

	return false;
}

function getPreferredAssetMatchers() {
	if (process.platform === "darwin") {
		const arch = process.arch === "arm64" ? "arm64" : "x64";
		return [
			(name: string) => name === `docsie-screen-recorder-mac-${arch}.dmg`,
			(name: string) => name.includes("mac") && name.includes(arch) && name.endsWith(".dmg"),
			(name: string) => name === "docsie-screen-recorder-mac-universal.dmg",
			(name: string) => name.includes("mac") && name.includes("universal") && name.endsWith(".dmg"),
		];
	}

	if (process.platform === "win32") {
		return [
			(name: string) =>
				name.endsWith(".exe") && name.includes("setup") && !name.endsWith(".blockmap"),
		];
	}

	if (process.platform === "linux") {
		return [(name: string) => name.includes("linux") && name.endsWith(".appimage")];
	}

	return [];
}

function asString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getUpdateName(info: UpdateInfo) {
	return asString(info.releaseName) ?? `Docsie Screen Recorder ${info.version}`;
}

function getPreferredDownloadUrl(release: GitHubRelease) {
	const preferredAssetMatchers = getPreferredAssetMatchers();
	const assets = Array.isArray(release.assets) ? release.assets : [];

	for (const matchesAsset of preferredAssetMatchers) {
		for (const asset of assets) {
			const entry = asset as GitHubReleaseAsset;
			const assetName = asString(entry.name)?.toLowerCase();
			if (assetName && matchesAsset(assetName)) {
				const downloadUrl = asString(entry.browser_download_url);
				if (downloadUrl) {
					return downloadUrl;
				}
			}
		}
	}

	return asString(release.html_url) ?? RELEASES_PAGE_URL;
}

async function readUpdateCheckState(): Promise<UpdateCheckState> {
	try {
		const raw = await fs.readFile(UPDATE_STATE_PATH, "utf-8");
		const parsed = JSON.parse(raw) as UpdateCheckState;
		return {
			skippedVersion: asString(parsed.skippedVersion) ?? undefined,
		};
	} catch {
		return {};
	}
}

async function writeUpdateCheckState(state: UpdateCheckState) {
	await fs.writeFile(UPDATE_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(RELEASES_API_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "Docsie-Screen-Recorder",
			},
			signal: abortController.signal,
		});

		if (!response.ok) {
			throw new Error(`GitHub release check failed with ${response.status}`);
		}

		return (await response.json()) as GitHubRelease;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function getAvailableBrowserUpdate(): Promise<BrowserUpdateInfo | null> {
	const release = await fetchLatestRelease();
	const tagName = asString(release.tag_name);
	if (!tagName) {
		return null;
	}

	const latestVersion = normalizeVersion(tagName);
	if (!isNewerVersion(latestVersion, app.getVersion())) {
		return null;
	}

	return {
		version: latestVersion,
		name: asString(release.name) ?? `Docsie Screen Recorder ${latestVersion}`,
		pageUrl: asString(release.html_url) ?? RELEASES_PAGE_URL,
		downloadUrl: getPreferredDownloadUrl(release) ?? RELEASES_PAGE_URL,
	};
}

function canUseNativeUpdater() {
	// The current release flow produces NSIS update metadata for Windows.
	// Keep macOS/Linux on the browser fallback until their releases include
	// updater-compatible metadata and install formats.
	return app.isPackaged && process.platform === "win32";
}

function configureNativeUpdater() {
	autoUpdater.autoDownload = false;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.autoRunAppAfterInstall = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.logger = {
		info: (message?: unknown) => console.info("[updater]", message),
		warn: (message?: unknown) => console.warn("[updater]", message),
		error: (message?: unknown) => console.error("[updater]", message),
	};
}

async function getAvailableNativeUpdate(): Promise<NativeUpdateInfo | null> {
	if (!canUseNativeUpdater()) {
		return null;
	}

	configureNativeUpdater();
	const result = await autoUpdater.checkForUpdates();
	const info = result?.updateInfo;
	if (!info || !isNewerVersion(info.version, app.getVersion())) {
		return null;
	}

	return {
		version: info.version,
		name: getUpdateName(info),
	};
}

async function downloadAndInstallNativeUpdate(
	parent: BrowserWindow | undefined,
	update: NativeUpdateInfo,
) {
	const progressWindow = parent && !parent.isDestroyed() ? parent : null;
	const onProgress = (progress: ProgressInfo) => {
		progressWindow?.setProgressBar(Math.max(0, Math.min(1, progress.percent / 100)));
	};

	try {
		autoUpdater.on("download-progress", onProgress);
		await autoUpdater.downloadUpdate();
		progressWindow?.setProgressBar(-1);

		const result = await showNativeMessageBox(parent, {
			type: "info",
			title: "Update ready",
			message: `Docsie Screen Recorder ${update.version} is ready to install.`,
			detail: "Restart Docsie Screen Recorder to finish installing the update.",
			buttons: ["Restart and Install", "Later"],
			defaultId: 0,
			cancelId: 1,
		});

		if (result.response === 0) {
			autoUpdater.quitAndInstall(false, true);
		}
	} finally {
		autoUpdater.off("download-progress", onProgress);
		progressWindow?.setProgressBar(-1);
	}
}

async function openBrowserDownload(update: BrowserUpdateInfo) {
	await writeUpdateCheckState({});
	await shell.openExternal(update.downloadUrl || update.pageUrl);
}

async function handleNativeUpdate(
	parent: BrowserWindow | undefined,
	update: NativeUpdateInfo,
	options?: { manual?: boolean },
) {
	const state = await readUpdateCheckState();
	if (!options?.manual && state.skippedVersion === update.version) {
		return;
	}

	const result = await showNativeMessageBox(parent, {
		type: "info",
		title: "Update available",
		message: `Docsie Screen Recorder ${update.version} is available.`,
		detail: `Installed version: ${app.getVersion()}\nLatest release: ${update.name}`,
		buttons: ["Install Update", "Download in Browser", "Later", "Skip This Version"],
		defaultId: 0,
		cancelId: 2,
	});

	if (result.response === 0) {
		await writeUpdateCheckState({});
		await downloadAndInstallNativeUpdate(parent, update);
		return;
	}

	if (result.response === 1) {
		const browserUpdate = await getAvailableBrowserUpdate();
		if (browserUpdate) {
			await openBrowserDownload(browserUpdate);
		}
		return;
	}

	if (result.response === 3) {
		await writeUpdateCheckState({ skippedVersion: update.version });
	}
}

async function handleBrowserUpdate(
	parent: BrowserWindow | undefined,
	update: BrowserUpdateInfo,
	options?: { manual?: boolean },
) {
	const state = await readUpdateCheckState();
	if (!options?.manual && state.skippedVersion === update.version) {
		return;
	}

	const result = await showNativeMessageBox(parent, {
		type: "info",
		title: "Update available",
		message: `Docsie Screen Recorder ${update.version} is available.`,
		detail: `Installed version: ${app.getVersion()}\nLatest release: ${update.name}`,
		buttons: ["Download", "Later", "Skip This Version"],
		defaultId: 0,
		cancelId: 1,
	});

	if (result.response === 0) {
		await openBrowserDownload(update);
		return;
	}

	if (result.response === 2) {
		await writeUpdateCheckState({ skippedVersion: update.version });
	}
}

export async function checkForUpdates(options?: {
	manual?: boolean;
	parent?: BrowserWindow | null;
}) {
	const parent = options?.parent && !options.parent.isDestroyed() ? options.parent : undefined;

	try {
		const nativeUpdate = await getAvailableNativeUpdate();
		if (nativeUpdate) {
			await handleNativeUpdate(parent, nativeUpdate, options);
			return;
		}
	} catch (error) {
		console.warn("Native updater failed; falling back to browser update check:", error);
	}

	try {
		const update = await getAvailableBrowserUpdate();
		if (!update) {
			if (options?.manual) {
				await showNativeMessageBox(parent, {
					type: "info",
					title: "Docsie Screen Recorder is up to date",
					message: "You are using the latest version.",
					detail: `Installed version: ${app.getVersion()}`,
					buttons: ["OK"],
				});
			}
			return;
		}

		await handleBrowserUpdate(parent, update, options);
	} catch (error) {
		console.warn("Failed to check for updates:", error);
		if (options?.manual) {
			await showNativeMessageBox(parent, {
				type: "warning",
				title: "Update check failed",
				message: "Docsie Screen Recorder could not check for updates.",
				detail: error instanceof Error ? error.message : String(error),
				buttons: ["OK"],
			});
		}
	}
}
