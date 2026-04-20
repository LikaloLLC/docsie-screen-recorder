import fs from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type {
	DocsieAuthMode,
	DocsieEstimateInput,
	DocsieEstimateResult,
	DocsieIntegrationConfigInput,
	DocsieIntegrationState,
	DocsieStartVideoToDocsInput,
	DocsieStartVideoToDocsResult,
	DocsieVideoToDocsJobResult,
	DocsieVideoToDocsJobStatus,
	DocsieWorkspace,
} from "../../src/lib/docsieIntegration";

const DOCSIE_CONFIG_PATH = path.join(app.getPath("userData"), "docsie-integration.json");
const DEFAULT_API_PATH = "/api_v2/v3";
const DEFAULT_LANGUAGE = "english";
const DEFAULT_QUALITY = "standard";
const DEFAULT_DOC_STYLE = "guide";

interface StoredDocsieConfig {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	tokenEncrypted?: string;
	tokenPlaintext?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality?: string;
	defaultLanguage?: string;
	defaultDocStyle?: string;
	autoGenerate?: boolean;
}

interface ResolvedDocsieConfig {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	token: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality: string;
	defaultLanguage: string;
	defaultDocStyle: string;
	autoGenerate: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDocsieApiBaseUrl(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		throw new Error("Docsie API base URL is required");
	}

	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error("Docsie API base URL must be a valid URL");
	}

	const currentPath = parsed.pathname.replace(/\/+$/, "");
	if (!currentPath) {
		parsed.pathname = DEFAULT_API_PATH;
	} else if (!/\/api_v2\/(?:v3|003)$/.test(currentPath)) {
		parsed.pathname = `${currentPath}${DEFAULT_API_PATH}`;
	} else {
		parsed.pathname = currentPath;
	}

	return parsed.toString().replace(/\/+$/, "");
}

function encryptToken(token: string): { tokenEncrypted?: string; tokenPlaintext?: string } {
	if (safeStorage.isEncryptionAvailable()) {
		const encrypted = safeStorage.encryptString(token);
		return { tokenEncrypted: Buffer.from(encrypted).toString("base64") };
	}

	return { tokenPlaintext: token };
}

function decryptToken(stored: StoredDocsieConfig): string | undefined {
	if (stored.tokenEncrypted) {
		try {
			return safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, "base64"));
		} catch (error) {
			console.warn("Failed to decrypt Docsie token:", error);
		}
	}

	return asString(stored.tokenPlaintext);
}

async function readStoredDocsieConfig(): Promise<StoredDocsieConfig | null> {
	try {
		const raw = await fs.readFile(DOCSIE_CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		if (!isRecord(parsed)) {
			return null;
		}

		return {
			apiBaseUrl: asString(parsed.apiBaseUrl) ?? "",
			authMode: parsed.authMode === "bearer" ? "bearer" : "apiKey",
			tokenEncrypted: asString(parsed.tokenEncrypted),
			tokenPlaintext: asString(parsed.tokenPlaintext),
			workspaceId: asString(parsed.workspaceId),
			workspaceName: asString(parsed.workspaceName),
			defaultQuality: asString(parsed.defaultQuality),
			defaultLanguage: asString(parsed.defaultLanguage),
			defaultDocStyle: asString(parsed.defaultDocStyle),
			autoGenerate: typeof parsed.autoGenerate === "boolean" ? parsed.autoGenerate : undefined,
		};
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			console.warn("Failed to read Docsie integration config:", error);
		}
		return null;
	}
}

function toDocsieState(stored: StoredDocsieConfig | null): DocsieIntegrationState {
	return {
		apiBaseUrl: stored?.apiBaseUrl ?? "",
		authMode: stored?.authMode ?? "apiKey",
		hasToken: Boolean(stored && decryptToken(stored)),
		workspaceId: stored?.workspaceId,
		workspaceName: stored?.workspaceName,
		defaultQuality:
			(stored?.defaultQuality as DocsieIntegrationState["defaultQuality"]) ?? DEFAULT_QUALITY,
		defaultLanguage: stored?.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle:
			(stored?.defaultDocStyle as DocsieIntegrationState["defaultDocStyle"]) ?? DEFAULT_DOC_STYLE,
		autoGenerate: stored?.autoGenerate ?? true,
	};
}

async function resolveDocsieConfig(): Promise<ResolvedDocsieConfig> {
	const stored = await readStoredDocsieConfig();
	if (!stored?.apiBaseUrl) {
		throw new Error("Docsie integration is not configured");
	}

	const token = decryptToken(stored);
	if (!token) {
		throw new Error("Docsie API token is not configured");
	}

	return {
		apiBaseUrl: stored.apiBaseUrl,
		authMode: stored.authMode ?? "apiKey",
		token,
		workspaceId: stored.workspaceId,
		workspaceName: stored.workspaceName,
		defaultQuality: stored.defaultQuality ?? DEFAULT_QUALITY,
		defaultLanguage: stored.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle: stored.defaultDocStyle ?? DEFAULT_DOC_STYLE,
		autoGenerate: stored.autoGenerate ?? true,
	};
}

function buildDocsieHeaders(config: ResolvedDocsieConfig, extra?: Record<string, string>) {
	return {
		Accept: "application/json",
		Authorization: `${config.authMode === "bearer" ? "Bearer" : "Api-Key"} ${config.token}`,
		...extra,
	};
}

async function docsieJsonRequest(
	config: ResolvedDocsieConfig,
	requestPath: string,
	options?: RequestInit,
): Promise<unknown> {
	const response = await fetch(`${config.apiBaseUrl}${requestPath}`, {
		...options,
		headers: {
			...buildDocsieHeaders(config),
			...(options?.headers ?? {}),
		},
	});

	const contentType = response.headers.get("content-type") ?? "";
	const payload = contentType.includes("application/json")
		? await response.json()
		: await response.text();

	if (!response.ok) {
		if (isRecord(payload)) {
			const message = asString(payload.message) ?? asString(payload.error);
			throw new Error(message ?? `Docsie request failed (${response.status})`);
		}

		throw new Error(
			typeof payload === "string" && payload
				? payload
				: `Docsie request failed (${response.status})`,
		);
	}

	return payload;
}

async function uploadBinaryToPresignedUrl(
	url: string,
	contentType: string,
	data: Buffer,
): Promise<void> {
	const response = await fetch(url, {
		method: "PUT",
		headers: {
			"Content-Type": contentType,
		},
		body: new Uint8Array(data),
	});

	if (!response.ok) {
		throw new Error(`Failed to upload video to Docsie storage (${response.status})`);
	}
}

function sanitizeFilenameSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function getMimeTypeForVideo(filePath: string): string {
	switch (path.extname(filePath).toLowerCase()) {
		case ".mp4":
			return "video/mp4";
		case ".mov":
			return "video/quicktime";
		case ".avi":
			return "video/x-msvideo";
		case ".mkv":
			return "video/x-matroska";
		case ".webm":
		default:
			return "video/webm";
	}
}

function normalizeWorkspacePayload(payload: unknown): DocsieWorkspace[] {
	const items = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.results)
			? payload.results
			: [];

	return items
		.filter((item): item is Record<string, unknown> => isRecord(item))
		.map((item) => ({
			id: String(item.id ?? ""),
			name: asString(item.name) ?? asString(item.slug) ?? String(item.id ?? "Workspace"),
			slug: asString(item.slug),
			documentationId: asNullableString(item.documentation_id),
		}))
		.filter((workspace) => workspace.id);
}

function normalizeEstimateResponse(payload: unknown): DocsieEstimateResult {
	if (!isRecord(payload)) {
		return { success: false, error: "Unexpected Docsie estimate response" };
	}

	return {
		success: true,
		quality: (asString(payload.quality) as DocsieEstimateResult["quality"]) ?? undefined,
		secondsPerFrame: asNumber(payload.seconds_per_frame) ?? undefined,
		creditsPerMinute: asNumber(payload.credits_per_minute) ?? undefined,
		durationMinutes: asNumber(payload.duration_minutes) ?? undefined,
		estimate: isRecord(payload.estimate) ? payload.estimate : null,
		balance: isRecord(payload.balance) ? payload.balance : null,
		hasSufficientCredits:
			typeof payload.has_sufficient_credits === "boolean"
				? payload.has_sufficient_credits
				: undefined,
	};
}

function normalizeJobStatus(payload: unknown): DocsieVideoToDocsJobStatus {
	if (!isRecord(payload)) {
		return { success: false, error: "Unexpected Docsie job status response" };
	}

	return {
		success: true,
		jobId: asString(payload.job_id),
		status: asString(payload.status),
		normalizedStatus: asNullableString(payload.normalized_status),
		workspaceId: asNullableString(payload.workspace_id),
		createdAt: asNullableString(payload.created_at),
		updatedAt: asNullableString(payload.updated_at),
		sourceType: asNullableString(payload.source_type),
		sourceFileId: asNullableString(payload.source_file_id),
		sourceVideoUrl: asNullableString(payload.source_video_url),
		quality: asNullableString(payload.quality),
		canPoll: typeof payload.can_poll === "boolean" ? payload.can_poll : undefined,
		result: isRecord(payload.result) ? payload.result : null,
		error: asNullableString(payload.error),
	};
}

function normalizeJobResult(payload: unknown): DocsieVideoToDocsJobResult {
	if (!isRecord(payload)) {
		return { success: false, error: "Unexpected Docsie job result response" };
	}

	return {
		success: true,
		jobId: asString(payload.job_id),
		status: asString(payload.status),
		workspaceId: asNullableString(payload.workspace_id),
		sourceType: asNullableString(payload.source_type),
		sourceFileId: asNullableString(payload.source_file_id),
		sourceVideoUrl: asNullableString(payload.source_video_url),
		sessionId: asNullableString(payload.session_id),
		title: asNullableString(payload.title),
		style: asNullableString(payload.style),
		language: asNullableString(payload.language),
		markdown: typeof payload.markdown === "string" ? payload.markdown : undefined,
		durationMinutes: asNumber(payload.duration_minutes),
		durationSeconds: asNumber(payload.duration_seconds),
		quality: asNullableString(payload.quality),
		secondsPerFrame: asNumber(payload.seconds_per_frame),
		resultUrl: asNullableString(payload.result_url),
		transcription: payload.transcription,
		transcriptionRaw: payload.transcription_raw,
		transcriptionUrl: asNullableString(payload.transcription_url),
		sections: Array.isArray(payload.sections) ? payload.sections : [],
		images: Array.isArray(payload.images) ? payload.images : [],
		creditsCharged: asNumber(payload.credits_charged),
		creditBalanceAfter: asNumber(payload.credit_balance_after),
		rehostedImages: asNumber(payload.rehosted_images),
		expiresInSeconds: asNumber(payload.expires_in_seconds),
		exports: isRecord(payload.exports) ? payload.exports : null,
		raw: payload,
		error: asNullableString(payload.error),
		message: asNullableString(payload.message),
	};
}

export async function getDocsieIntegrationState(): Promise<DocsieIntegrationState> {
	return toDocsieState(await readStoredDocsieConfig());
}

export async function saveDocsieIntegrationConfig(
	input: DocsieIntegrationConfigInput,
): Promise<DocsieIntegrationState> {
	const stored = await readStoredDocsieConfig();
	const normalizedApiBaseUrl = normalizeDocsieApiBaseUrl(input.apiBaseUrl);
	const nextToken = asString(input.token) ?? (stored ? decryptToken(stored) : undefined);
	if (!nextToken) {
		throw new Error("Docsie API token is required");
	}

	const persisted: StoredDocsieConfig = {
		apiBaseUrl: normalizedApiBaseUrl,
		authMode: input.authMode,
		workspaceId: asString(input.workspaceId),
		workspaceName: asString(input.workspaceName),
		defaultQuality: input.defaultQuality ?? stored?.defaultQuality ?? DEFAULT_QUALITY,
		defaultLanguage: asString(input.defaultLanguage) ?? stored?.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle: input.defaultDocStyle ?? stored?.defaultDocStyle ?? DEFAULT_DOC_STYLE,
		autoGenerate: input.autoGenerate ?? stored?.autoGenerate ?? true,
		...encryptToken(nextToken),
	};

	await fs.writeFile(DOCSIE_CONFIG_PATH, JSON.stringify(persisted, null, 2), "utf-8");
	return toDocsieState(persisted);
}

export async function listDocsieWorkspaces(): Promise<DocsieWorkspace[]> {
	const config = await resolveDocsieConfig();
	const payload = await docsieJsonRequest(config, "/workspaces/");
	return normalizeWorkspacePayload(payload);
}

export async function estimateDocsieVideoToDocs(
	input: DocsieEstimateInput,
): Promise<DocsieEstimateResult> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, "/video-to-docs/estimate/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				quality: input.quality,
				...(typeof input.durationMinutes === "number"
					? { duration_minutes: input.durationMinutes }
					: {}),
				...(typeof input.durationSeconds === "number"
					? { duration_seconds: input.durationSeconds }
					: {}),
			}),
		});

		return normalizeEstimateResponse(payload);
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function startDocsieVideoToDocs(
	input: DocsieStartVideoToDocsInput,
): Promise<DocsieStartVideoToDocsResult> {
	try {
		const config = await resolveDocsieConfig();
		const workspaceId = asString(input.workspaceId) ?? config.workspaceId;
		if (!workspaceId) {
			throw new Error("Select a Docsie workspace before sending a recording");
		}

		const normalizedVideoPath = path.resolve(input.videoPath);
		const fileBuffer = await fs.readFile(normalizedVideoPath);
		const mimeType = getMimeTypeForVideo(normalizedVideoPath);
		const basename = path.basename(normalizedVideoPath);
		const remoteName = sanitizeFilenameSegment(
			`docsie-screen-${Date.now()}-${basename || `recording${path.extname(normalizedVideoPath)}`}`,
		);

		const tempUploadPayload = await docsieJsonRequest(config, "/files/generate_temp_url/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				key: `docsie-screen-recorder/${remoteName}`,
				content_type: mimeType,
				public: false,
			}),
		});

		if (!isRecord(tempUploadPayload)) {
			throw new Error("Docsie did not return a temporary upload URL");
		}

		const uploadUrl = asString(tempUploadPayload.url);
		const tempKey = asString(tempUploadPayload.key);
		if (!uploadUrl || !tempKey) {
			throw new Error("Docsie upload bootstrap response was incomplete");
		}

		await uploadBinaryToPresignedUrl(uploadUrl, mimeType, fileBuffer);

		const filePayload = await docsieJsonRequest(config, "/files/upload/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				workspace: workspaceId,
				temp_key: tempKey,
				type: "file",
				public: false,
			}),
		});

		if (!isRecord(filePayload)) {
			throw new Error("Docsie did not return a file record");
		}

		const fileId = asString(filePayload.id);
		if (!fileId) {
			throw new Error("Docsie file registration did not return a file ID");
		}

		const submitPayload = await docsieJsonRequest(config, "/video-to-docs/submit/", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				file_id: fileId,
				quality: input.quality ?? config.defaultQuality,
				language: asString(input.language) ?? config.defaultLanguage,
				workspace_id: workspaceId,
				doc_style: input.docStyle ?? config.defaultDocStyle,
				rewrite_instructions: asString(input.rewriteInstructions) ?? "",
				template_instruction: asString(input.templateInstruction) ?? "",
				auto_generate: input.autoGenerate ?? config.autoGenerate,
			}),
		});

		if (!isRecord(submitPayload)) {
			throw new Error("Docsie did not return a job response");
		}

		return {
			success: true,
			jobId: asString(submitPayload.job_id),
			fileId,
			workspaceId: asNullableString(submitPayload.workspace_id),
			status: asString(submitPayload.status),
			quality:
				(asString(submitPayload.quality) as DocsieStartVideoToDocsResult["quality"]) ?? undefined,
			sourceType: asNullableString(submitPayload.source_type),
			creditsPerMinute: asNumber(submitPayload.credits_per_minute) ?? undefined,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function getDocsieVideoToDocsJobStatus(
	jobId: string,
): Promise<DocsieVideoToDocsJobStatus> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, `/video-to-docs/${jobId}/status/`);
		return normalizeJobStatus(payload);
	} catch (error) {
		return {
			success: false,
			jobId,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function getDocsieVideoToDocsJobResult(
	jobId: string,
): Promise<DocsieVideoToDocsJobResult> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, `/video-to-docs/${jobId}/result/`);
		return normalizeJobResult(payload);
	} catch (error) {
		return {
			success: false,
			jobId,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
