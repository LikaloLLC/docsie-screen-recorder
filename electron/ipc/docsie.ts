import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, safeStorage } from "electron";
import type {
	DocsieAsyncJobResult,
	DocsieAuthMode,
	DocsieCreditBalance,
	DocsieCreditBalanceResult,
	DocsieDesktopHandoffExchangeResult,
	DocsieDesktopHandoffInput,
	DocsieDocumentationShelf,
	DocsieEstimateInput,
	DocsieEstimateResult,
	DocsieGenerateVideoToDocsInput,
	DocsieGenerateVideoToDocsResult,
	DocsieGenerateVoiceoverInput,
	DocsieGenerateVoiceoverResult,
	DocsieGenerationTemplate,
	DocsieIntegrationConfigInput,
	DocsieIntegrationState,
	DocsieListDocumentationShelvesInput,
	DocsieListVoiceOptionsInput,
	DocsieOutputFormat,
	DocsiePptxImageQuality,
	DocsiePptxOptions,
	DocsieSaveVideoToDocsHistoryInput,
	DocsieStartVideoToDocsInput,
	DocsieStartVideoToDocsResult,
	DocsieTranscribeAudioInput,
	DocsieTranscriptionOption,
	DocsieTranscriptionOptionsResult,
	DocsieTranscriptionResult,
	DocsieVideoToDocsHistoryEntry,
	DocsieVideoToDocsJobResult,
	DocsieVideoToDocsJobStatus,
	DocsieVoiceDefaultOptions,
	DocsieVoiceOption,
	DocsieVoiceOptionsResult,
	DocsieVoiceProvider,
	DocsieWorkspace,
} from "../../src/lib/docsieIntegration";

const DOCSIE_CONFIG_PATH = path.join(app.getPath("userData"), "docsie-integration.json");
const DOCSIE_HISTORY_PATH = path.join(app.getPath("userData"), "docsie-video-to-docs-history.json");
const DOCSIE_VOICEOVER_DIR = path.join(app.getPath("userData"), "docsie-voiceovers");
const DEFAULT_API_PATH = "/api_v2/v3";
const DEFAULT_VOICE_OPTIONS_PATH = "/voice/options/";
const DEFAULT_VOICE_SPEECH_PATH = "/voice/speech/";
const DEFAULT_TRANSCRIPTION_OPTIONS_PATH = "/transcription/options/";
const DEFAULT_TRANSCRIPTION_AUDIO_PATH = "/transcription/audio/";
const DEFAULT_LANGUAGE = "english";
const DEFAULT_QUALITY = "standard";
const DEFAULT_DOC_STYLE = "guide";
const DEFAULT_OUTPUT_FORMATS: DocsieOutputFormat[] = ["md", "docx", "pdf"];
const ALLOWED_OUTPUT_FORMATS = new Set<DocsieOutputFormat>(["md", "docx", "pdf", "pptx"]);
const OUTPUT_FORMAT_ALIASES: Record<string, DocsieOutputFormat> = {
	markdown: "md",
	ppt: "pptx",
	powerpoint: "pptx",
	presentation: "pptx",
	slides: "pptx",
	slide_deck: "pptx",
};
const MAX_HISTORY_PER_VIDEO = 12;
const DOCSIE_ERROR_MAX_LENGTH = 320;

interface StoredDocsieConfig {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	tokenEncrypted?: string;
	tokenPlaintext?: string;
	organizationId?: string;
	organizationName?: string;
	organizationSlug?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality?: string;
	defaultLanguage?: string;
	defaultDocStyle?: string;
	defaultRewriteInstructions?: string;
	defaultGenerationTemplateId?: string;
	defaultTemplateInstruction?: string;
	targetDocumentationId?: string;
	autoGenerate?: boolean;
	defaultOutputFormats?: DocsieOutputFormat[];
	defaultPptxOptions?: DocsiePptxOptions;
	voiceApiEnabled?: boolean;
	voiceOptionsPath?: string;
	voiceSpeechPath?: string;
	defaultVoiceOptions?: DocsieVoiceDefaultOptions;
	transcriptionApiEnabled?: boolean;
	transcriptionOptionsPath?: string;
	transcriptionAudioPath?: string;
}

interface ResolvedDocsieConfig {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	token: string;
	organizationId?: string;
	organizationName?: string;
	organizationSlug?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality: string;
	defaultLanguage: string;
	defaultDocStyle: string;
	defaultRewriteInstructions?: string;
	defaultGenerationTemplateId?: string;
	defaultTemplateInstruction?: string;
	targetDocumentationId?: string;
	autoGenerate: boolean;
	defaultOutputFormats: DocsieOutputFormat[];
	defaultPptxOptions: DocsiePptxOptions;
	voiceApiEnabled: boolean;
	voiceOptionsPath: string;
	voiceSpeechPath: string;
	defaultVoiceOptions: DocsieVoiceDefaultOptions;
	transcriptionApiEnabled: boolean;
	transcriptionOptionsPath: string;
	transcriptionAudioPath: string;
}

interface StoredDocsieVideoToDocsHistory {
	version: number;
	entriesByVideoPath: Record<string, DocsieVideoToDocsHistoryEntry[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function decodeEscapedUnicode(value: string | undefined): string | undefined {
	if (!value) {
		return value;
	}

	return value.replace(
		/\\u([0-9a-fA-F]{4})\\u([0-9a-fA-F]{4})|\\u([0-9a-fA-F]{4})/g,
		(match, high, low, single) => {
			if (high && low) {
				const highCode = Number.parseInt(high, 16);
				const lowCode = Number.parseInt(low, 16);
				if (highCode >= 0xd800 && highCode <= 0xdbff && lowCode >= 0xdc00 && lowCode <= 0xdfff) {
					return String.fromCodePoint(0x10000 + ((highCode - 0xd800) << 10) + (lowCode - 0xdc00));
				}
			}

			const code = Number.parseInt(single ?? high, 16);
			return Number.isFinite(code) ? String.fromCharCode(code) : match;
		},
	);
}

function asNullableString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") {
		return value;
	}
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["1", "true", "yes", "on"].includes(normalized)) {
			return true;
		}
		if (["0", "false", "no", "off"].includes(normalized)) {
			return false;
		}
	}
	return undefined;
}

function normalizeDocsieOutputFormats(
	value: unknown,
	fallback: DocsieOutputFormat[] = DEFAULT_OUTPUT_FORMATS,
): DocsieOutputFormat[] {
	const candidates =
		typeof value === "string"
			? value.split(",")
			: Array.isArray(value)
				? value
				: value
					? [value]
					: [];
	const formats: DocsieOutputFormat[] = [];

	for (const candidate of candidates) {
		const raw = String(candidate ?? "")
			.trim()
			.toLowerCase();
		const normalized = OUTPUT_FORMAT_ALIASES[raw] ?? raw;
		if (
			ALLOWED_OUTPUT_FORMATS.has(normalized as DocsieOutputFormat) &&
			!formats.includes(normalized as DocsieOutputFormat)
		) {
			formats.push(normalized as DocsieOutputFormat);
		}
	}

	return formats.length > 0 ? formats : [...fallback];
}

function firstRecordValue(data: Record<string, unknown>, keys: string[]): unknown {
	for (const key of keys) {
		if (key in data) {
			return data[key];
		}
	}
	return undefined;
}

function normalizeDocsiePptxOptions(value: unknown): DocsiePptxOptions {
	if (!isRecord(value)) {
		return {};
	}

	const nested = normalizeDocsiePptxOptions(value.pptx_options);
	const options: DocsiePptxOptions = { ...nested };
	const stringFields: Array<[keyof DocsiePptxOptions, string[]]> = [
		["deckType", ["pptx_deck_type", "deck_type", "deckType"]],
		["sourceName", ["pptx_source_name", "source_name", "sourceName"]],
		["enhance", ["pptx_enhance", "enhance", "enhancement", "enhance_mode", "enhanceMode"]],
		["audience", ["pptx_audience", "audience"]],
		["imageQuality", ["pptx_image_quality", "image_quality", "imageQuality", "pptxImageQuality"]],
		[
			"illustrationStyle",
			[
				"pptx_illustration_style",
				"illustration_style",
				"illustrationStyle",
				"pptxIllustrationStyle",
			],
		],
	];

	for (const [optionKey, requestKeys] of stringFields) {
		const nextValue = asString(firstRecordValue(value, requestKeys));
		if (nextValue) {
			if (optionKey === "imageQuality") {
				if (["low", "medium", "high"].includes(nextValue)) {
					options.imageQuality = nextValue as DocsiePptxImageQuality;
				}
			} else {
				options[optionKey] = nextValue as never;
			}
		}
	}

	const maxSlides = firstRecordValue(value, ["pptx_max_slides", "max_slides", "maxSlides"]);
	const normalizedMaxSlides =
		typeof maxSlides === "number"
			? maxSlides
			: typeof maxSlides === "string"
				? Number.parseInt(maxSlides.trim(), 10)
				: undefined;
	if (
		typeof normalizedMaxSlides === "number" &&
		Number.isFinite(normalizedMaxSlides) &&
		normalizedMaxSlides >= 1 &&
		normalizedMaxSlides <= 100
	) {
		options.maxSlides = Math.round(normalizedMaxSlides);
	}

	const generateCoverImage = asBoolean(
		firstRecordValue(value, [
			"pptx_generate_cover_image",
			"generate_cover_image",
			"generateCoverImage",
			"cover_image",
			"coverImage",
		]),
	);
	if (typeof generateCoverImage === "boolean") {
		options.generateCoverImage = generateCoverImage;
	}

	const embedImages = asBoolean(
		firstRecordValue(value, ["pptx_embed_images", "embed_images", "embedImages"]),
	);
	if (typeof embedImages === "boolean") {
		options.embedImages = embedImages;
	}

	const theme = firstRecordValue(value, ["pptx_theme", "theme"]);
	if (theme !== undefined && theme !== "") {
		options.theme = theme;
	}

	return options;
}

function normalizeDocsieApiPath(value: unknown, fallback: string): string {
	const candidate = asString(value);
	if (!candidate || /^[a-z][a-z0-9+.-]*:/i.test(candidate) || candidate.startsWith("//")) {
		return fallback;
	}

	const withLeadingSlash = candidate.startsWith("/") ? candidate : `/${candidate}`;
	return withLeadingSlash.replace(/\/{2,}/g, "/");
}

function normalizeVoiceDefaultOptions(value: unknown): DocsieVoiceDefaultOptions {
	if (!isRecord(value)) {
		return {};
	}

	const options: DocsieVoiceDefaultOptions = {};
	const provider = asString(value.provider);
	const voiceId = asString(value.voice_id) ?? asString(value.voiceId);
	const responseFormat = asString(value.response_format) ?? asString(value.responseFormat);
	const speed = asNumber(value.speed);

	if (provider) options.provider = provider;
	if (voiceId) options.voice_id = voiceId;
	if (responseFormat) options.response_format = responseFormat;
	if (typeof speed === "number") options.speed = speed;

	for (const [key, entryValue] of Object.entries(value)) {
		if (key in options || key === "voiceId" || key === "responseFormat") {
			continue;
		}
		if (entryValue === undefined || entryValue === null || entryValue === "") {
			continue;
		}
		if (
			typeof entryValue === "string" ||
			typeof entryValue === "number" ||
			typeof entryValue === "boolean" ||
			Array.isArray(entryValue) ||
			isRecord(entryValue)
		) {
			options[key] = entryValue;
		}
	}

	return options;
}

function buildDocsiePathWithQuery(
	requestPath: string,
	params: Record<string, string | undefined>,
): string {
	const parsed = new URL(requestPath, "https://docsie.local");
	for (const [key, value] of Object.entries(params)) {
		if (value) {
			parsed.searchParams.set(key, value);
		}
	}
	return `${parsed.pathname}${parsed.search}`;
}

function hasPptxOutput(outputFormats: DocsieOutputFormat[]) {
	return outputFormats.includes("pptx");
}

function normalizeVideoHistoryPath(videoPath: string): string {
	return path.resolve(videoPath);
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

function encryptToken(token: string): {
	tokenEncrypted?: string;
	tokenPlaintext?: string;
} {
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
			organizationId: asString(parsed.organizationId),
			organizationName: asString(parsed.organizationName),
			organizationSlug: asString(parsed.organizationSlug),
			workspaceId: asString(parsed.workspaceId),
			workspaceName: asString(parsed.workspaceName),
			defaultQuality: asString(parsed.defaultQuality),
			defaultLanguage: asString(parsed.defaultLanguage),
			defaultDocStyle: asString(parsed.defaultDocStyle),
			defaultRewriteInstructions: asString(parsed.defaultRewriteInstructions),
			defaultGenerationTemplateId: asString(parsed.defaultGenerationTemplateId),
			defaultTemplateInstruction: asString(parsed.defaultTemplateInstruction),
			targetDocumentationId: asString(parsed.targetDocumentationId),
			autoGenerate: typeof parsed.autoGenerate === "boolean" ? parsed.autoGenerate : undefined,
			defaultOutputFormats: normalizeDocsieOutputFormats(
				parsed.defaultOutputFormats,
				DEFAULT_OUTPUT_FORMATS,
			),
			defaultPptxOptions: normalizeDocsiePptxOptions(parsed.defaultPptxOptions),
			voiceApiEnabled:
				typeof parsed.voiceApiEnabled === "boolean" ? parsed.voiceApiEnabled : undefined,
			voiceOptionsPath: normalizeDocsieApiPath(parsed.voiceOptionsPath, DEFAULT_VOICE_OPTIONS_PATH),
			voiceSpeechPath: normalizeDocsieApiPath(parsed.voiceSpeechPath, DEFAULT_VOICE_SPEECH_PATH),
			defaultVoiceOptions: normalizeVoiceDefaultOptions(parsed.defaultVoiceOptions),
			transcriptionApiEnabled:
				typeof parsed.transcriptionApiEnabled === "boolean"
					? parsed.transcriptionApiEnabled
					: undefined,
			transcriptionOptionsPath: normalizeDocsieApiPath(
				parsed.transcriptionOptionsPath,
				DEFAULT_TRANSCRIPTION_OPTIONS_PATH,
			),
			transcriptionAudioPath: normalizeDocsieApiPath(
				parsed.transcriptionAudioPath,
				DEFAULT_TRANSCRIPTION_AUDIO_PATH,
			),
		};
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			console.warn("Failed to read Docsie integration config:", error);
		}
		return null;
	}
}

async function readDocsieVideoToDocsHistory(): Promise<StoredDocsieVideoToDocsHistory> {
	try {
		const raw = await fs.readFile(DOCSIE_HISTORY_PATH, "utf-8");
		const parsed = JSON.parse(raw);
		if (
			isRecord(parsed) &&
			isRecord(parsed.entriesByVideoPath) &&
			typeof parsed.version === "number"
		) {
			return {
				version: parsed.version,
				entriesByVideoPath: parsed.entriesByVideoPath as Record<
					string,
					DocsieVideoToDocsHistoryEntry[]
				>,
			};
		}
	} catch (error) {
		const nodeError = error as NodeJS.ErrnoException;
		if (nodeError.code !== "ENOENT") {
			console.warn("Failed to read Docsie video-to-docs history:", error);
		}
	}

	return {
		version: 1,
		entriesByVideoPath: {},
	};
}

async function writeDocsieVideoToDocsHistory(
	history: StoredDocsieVideoToDocsHistory,
): Promise<void> {
	await fs.writeFile(DOCSIE_HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
}

function toDocsieState(stored: StoredDocsieConfig | null): DocsieIntegrationState {
	return {
		apiBaseUrl: stored?.apiBaseUrl ?? "",
		authMode: stored?.authMode ?? "apiKey",
		hasToken: Boolean(stored && decryptToken(stored)),
		organizationId: stored?.organizationId,
		organizationName: stored?.organizationName,
		organizationSlug: stored?.organizationSlug,
		workspaceId: stored?.workspaceId,
		workspaceName: stored?.workspaceName,
		defaultQuality:
			(stored?.defaultQuality as DocsieIntegrationState["defaultQuality"]) ?? DEFAULT_QUALITY,
		defaultLanguage: stored?.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle:
			(stored?.defaultDocStyle as DocsieIntegrationState["defaultDocStyle"]) ?? DEFAULT_DOC_STYLE,
		defaultRewriteInstructions: stored?.defaultRewriteInstructions ?? "",
		defaultGenerationTemplateId: stored?.defaultGenerationTemplateId ?? "",
		defaultTemplateInstruction: stored?.defaultTemplateInstruction ?? "",
		targetDocumentationId: stored?.targetDocumentationId,
		autoGenerate: stored?.autoGenerate ?? true,
		defaultOutputFormats: normalizeDocsieOutputFormats(
			stored?.defaultOutputFormats,
			DEFAULT_OUTPUT_FORMATS,
		),
		defaultPptxOptions: normalizeDocsiePptxOptions(stored?.defaultPptxOptions),
		voiceApiEnabled: stored?.voiceApiEnabled ?? false,
		voiceOptionsPath: stored?.voiceOptionsPath ?? DEFAULT_VOICE_OPTIONS_PATH,
		voiceSpeechPath: stored?.voiceSpeechPath ?? DEFAULT_VOICE_SPEECH_PATH,
		defaultVoiceOptions: normalizeVoiceDefaultOptions(stored?.defaultVoiceOptions),
		transcriptionApiEnabled: stored?.transcriptionApiEnabled ?? false,
		transcriptionOptionsPath:
			stored?.transcriptionOptionsPath ?? DEFAULT_TRANSCRIPTION_OPTIONS_PATH,
		transcriptionAudioPath: stored?.transcriptionAudioPath ?? DEFAULT_TRANSCRIPTION_AUDIO_PATH,
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
		organizationId: stored.organizationId,
		organizationName: stored.organizationName,
		organizationSlug: stored.organizationSlug,
		workspaceId: stored.workspaceId,
		workspaceName: stored.workspaceName,
		defaultQuality: stored.defaultQuality ?? DEFAULT_QUALITY,
		defaultLanguage: stored.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle: stored.defaultDocStyle ?? DEFAULT_DOC_STYLE,
		defaultRewriteInstructions: stored.defaultRewriteInstructions ?? "",
		defaultGenerationTemplateId: stored.defaultGenerationTemplateId ?? "",
		defaultTemplateInstruction: stored.defaultTemplateInstruction ?? "",
		targetDocumentationId: stored.targetDocumentationId,
		autoGenerate: stored.autoGenerate ?? true,
		defaultOutputFormats: normalizeDocsieOutputFormats(
			stored.defaultOutputFormats,
			DEFAULT_OUTPUT_FORMATS,
		),
		defaultPptxOptions: normalizeDocsiePptxOptions(stored.defaultPptxOptions),
		voiceApiEnabled: stored.voiceApiEnabled ?? false,
		voiceOptionsPath: stored.voiceOptionsPath ?? DEFAULT_VOICE_OPTIONS_PATH,
		voiceSpeechPath: stored.voiceSpeechPath ?? DEFAULT_VOICE_SPEECH_PATH,
		defaultVoiceOptions: normalizeVoiceDefaultOptions(stored.defaultVoiceOptions),
		transcriptionApiEnabled: stored.transcriptionApiEnabled ?? false,
		transcriptionOptionsPath: stored.transcriptionOptionsPath ?? DEFAULT_TRANSCRIPTION_OPTIONS_PATH,
		transcriptionAudioPath: stored.transcriptionAudioPath ?? DEFAULT_TRANSCRIPTION_AUDIO_PATH,
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
		throw new Error(formatDocsieError(payload, response.status));
	}

	return payload;
}

async function docsieBinaryRequest(
	config: ResolvedDocsieConfig,
	requestPath: string,
	options?: RequestInit,
): Promise<{ buffer: Buffer; headers: Headers }> {
	const response = await fetch(`${config.apiBaseUrl}${requestPath}`, {
		...options,
		headers: {
			...buildDocsieHeaders(config, { Accept: "audio/*, application/json" }),
			...(options?.headers ?? {}),
		},
	});

	if (!response.ok) {
		const contentType = response.headers.get("content-type") ?? "";
		const payload = contentType.includes("application/json")
			? await response.json()
			: await response.text();
		throw new Error(formatDocsieError(payload, response.status));
	}

	return {
		buffer: Buffer.from(await response.arrayBuffer()),
		headers: response.headers,
	};
}

function formatDocsieErrorValue(value: unknown): string | null {
	if (typeof value === "string") {
		return summarizeDocsieTextError(value);
	}
	if (Array.isArray(value)) {
		return value.map(formatDocsieErrorValue).filter(Boolean).join("; ") || null;
	}
	if (isRecord(value)) {
		const entries = Object.entries(value)
			.map(([key, entryValue]) => {
				const formatted = formatDocsieErrorValue(entryValue);
				return formatted ? `${key}: ${formatted}` : null;
			})
			.filter(Boolean);
		return entries.join("; ") || null;
	}
	return null;
}

function formatDocsieError(payload: unknown, statusCode: number): string {
	const directMessage = isRecord(payload)
		? (asString(payload.message) ?? asString(payload.error) ?? asString(payload.detail))
		: null;
	const payloadMessage = truncateDocsieError(
		(directMessage ? summarizeDocsieTextError(directMessage) : null) ??
			formatDocsieErrorValue(payload),
	);
	return payloadMessage
		? `Docsie request failed (${statusCode}): ${payloadMessage}`
		: `Docsie request failed (${statusCode})`;
}

function decodeBasicHtmlEntities(value: string): string {
	return value
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'");
}

function truncateDocsieError(value: string | null): string | null {
	if (!value) {
		return null;
	}
	return value.length > DOCSIE_ERROR_MAX_LENGTH
		? `${value.slice(0, DOCSIE_ERROR_MAX_LENGTH - 1)}…`
		: value;
}

function summarizeDocsieTextError(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}

	const title = trimmed.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const heading = trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
	if (title || heading) {
		return decodeBasicHtmlEntities(title ?? heading ?? "")
			.replace(/\s+/g, " ")
			.trim();
	}

	const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(trimmed);
	const text = looksLikeHtml
		? trimmed
				.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
				.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
				.replace(/<!--[\s\S]*?-->/g, " ")
				.replace(/<[^>]+>/g, " ")
		: trimmed;

	return decodeBasicHtmlEntities(text).replace(/\s+/g, " ").trim() || null;
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
		throw new Error(`Failed to upload media to Docsie storage (${response.status})`);
	}
}

function sanitizeFilenameSegment(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function parseContentDispositionFilename(value: string | null): string | null {
	if (!value) {
		return null;
	}

	const encodedMatch = value.match(/filename\*=UTF-8''([^;]+)/i);
	if (encodedMatch?.[1]) {
		try {
			return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ""));
		} catch {
			return encodedMatch[1].trim().replace(/^"|"$/g, "");
		}
	}

	return value.match(/filename="?([^";]+)"?/i)?.[1]?.trim() ?? null;
}

function getAudioExtension(contentType: string | null): string {
	const normalized = (contentType ?? "").split(";")[0].trim().toLowerCase();
	switch (normalized) {
		case "audio/mpeg":
		case "audio/mp3":
			return ".mp3";
		case "audio/wav":
		case "audio/x-wav":
			return ".wav";
		case "audio/ogg":
			return ".ogg";
		case "audio/mp4":
		case "audio/aac":
			return ".m4a";
		case "audio/webm":
			return ".webm";
		default:
			return ".mp3";
	}
}

function normalizeAudioFilename(
	value: string | null | undefined,
	contentType: string | null,
): string {
	const fallback = `screen-recorder-narration-${Date.now()}`;
	const parsed = path.parse(sanitizeFilenameSegment(value || fallback));
	const extension = parsed.ext || getAudioExtension(contentType);
	const name = parsed.name || fallback;
	return `${name}${extension}`;
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

function normalizeDocumentationShelfPayload(payload: unknown): DocsieDocumentationShelf[] {
	const items = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.results)
			? payload.results
			: [];

	return items
		.filter((item): item is Record<string, unknown> => isRecord(item))
		.map((item) => {
			const workspace = isRecord(item.workspace) ? item.workspace : null;
			return {
				id: String(item.id ?? ""),
				name: asString(item.name) ?? asString(item.slug) ?? String(item.id ?? "Shelf"),
				slug: asString(item.slug),
				workspaceId: workspace ? asNullableString(workspace.id) : asNullableString(item.workspace),
				primary: typeof item.primary === "boolean" ? item.primary : undefined,
				activeBooksCount: asNumber(item.active_books_count),
			};
		})
		.filter((shelf) => shelf.id);
}

function normalizeGenerationTemplatePayload(payload: unknown): DocsieGenerationTemplate[] {
	const items = Array.isArray(payload)
		? payload
		: isRecord(payload) && Array.isArray(payload.results)
			? payload.results
			: isRecord(payload) && Array.isArray(payload.templates)
				? payload.templates
				: [];

	return items
		.filter((item): item is Record<string, unknown> => isRecord(item))
		.map((item) => ({
			id: String(item.id ?? ""),
			name: asString(item.name) ?? String(item.id ?? "Template"),
			category: asString(item.category) ?? "other",
			description: asString(item.description),
			icon: decodeEscapedUnicode(asString(item.icon)),
			preview: Array.isArray(item.preview)
				? item.preview
						.map((value) => asString(value))
						.filter((value): value is string => Boolean(value))
				: [],
			outline: Array.isArray(item.outline)
				? item.outline
						.filter((value): value is Record<string, unknown> => isRecord(value))
						.map((value) => ({
							title: asString(value.title) ?? "",
							description: asString(value.description),
						}))
						.filter((value) => value.title)
				: [],
			exampleMarkdown: asString(item.example_markdown) ?? asString(item.exampleMarkdown),
			previewMarkdown: asString(item.preview_markdown) ?? asString(item.previewMarkdown),
		}))
		.filter((template) => template.id);
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

function normalizeCreditBalancePayload(payload: unknown): DocsieCreditBalance {
	const data: Record<string, unknown> = isRecord(payload) ? payload : {};
	return {
		monthlyAllocated: asNumber(data.monthly_allocated) ?? undefined,
		monthlyUsed: asNumber(data.monthly_used) ?? undefined,
		monthlyRemaining: asNumber(data.monthly_remaining) ?? undefined,
		purchasedBalance: asNumber(data.purchased_balance) ?? undefined,
		totalAvailable: asNumber(data.total_available) ?? undefined,
		monthlyResetsAt: asNullableString(data.monthly_resets_at),
		billingMode: asString(data.billing_mode),
		videoQualityTiers: isRecord(data.video_quality_tiers) ? data.video_quality_tiers : undefined,
		raw: data,
	};
}

function normalizeVoiceOptionsPayload(
	payload: unknown,
	defaultVoiceOptions: DocsieVoiceDefaultOptions,
): DocsieVoiceOptionsResult {
	if (!isRecord(payload)) {
		return {
			success: false,
			tiers: [],
			providers: [],
			defaultVoiceOptions,
			error: "Unexpected Docsie voice options response",
		};
	}

	const tiers = Array.isArray(payload.tiers)
		? payload.tiers.map((tier) => asString(tier)).filter((tier): tier is string => Boolean(tier))
		: [];
	const providers = Array.isArray(payload.providers)
		? payload.providers
				.filter((provider): provider is Record<string, unknown> => isRecord(provider))
				.map((provider): DocsieVoiceProvider => {
					const providerId = asString(provider.provider) ?? "";
					const voices = Array.isArray(provider.voices)
						? provider.voices
								.filter((voice): voice is Record<string, unknown> => isRecord(voice))
								.map(
									(voice): DocsieVoiceOption => ({
										provider: asString(voice.provider) ?? providerId,
										id: String(voice.id ?? ""),
										name: asString(voice.name) ?? String(voice.id ?? "Voice"),
										tier: asString(voice.tier),
										model: asString(voice.model),
										raw: voice,
									}),
								)
								.filter((voice) => voice.id)
						: [];

					return {
						provider: providerId,
						configured: provider.configured === true,
						defaultModel: asString(provider.default_model) ?? asString(provider.defaultModel),
						voices,
						message: asString(provider.message),
						raw: provider,
					};
				})
				.filter((provider) => provider.provider)
		: [];

	return {
		success: payload.success !== false,
		source: asString(payload.source) ?? undefined,
		preferredProvider: asString(payload.preferred_provider) ?? asString(payload.preferredProvider),
		tiers,
		providers,
		defaultVoiceOptions,
	};
}

function normalizeTranscriptionOptionsPayload(payload: unknown): DocsieTranscriptionOptionsResult {
	if (!isRecord(payload)) {
		return {
			success: false,
			languages: [],
			error: "Unexpected Docsie transcription options response",
		};
	}

	const rawLanguages = Array.isArray(payload.languages)
		? payload.languages
		: Array.isArray(payload.language_options)
			? payload.language_options
			: [];
	const languages: DocsieTranscriptionOption[] = rawLanguages
		.map((language): DocsieTranscriptionOption | null => {
			if (typeof language === "string") {
				return { code: language };
			}
			if (!isRecord(language)) {
				return null;
			}
			const code = asString(language.code) ?? asString(language.id) ?? asString(language.value);
			if (!code) {
				return null;
			}
			return {
				code,
				name: asString(language.name) ?? asString(language.label),
				raw: language,
			};
		})
		.filter((language): language is DocsieTranscriptionOption => Boolean(language));

	const audioPath = normalizeDocsieApiPath(
		payload.audio_path ?? payload.audioPath,
		DEFAULT_TRANSCRIPTION_AUDIO_PATH,
	);

	return {
		success: payload.success !== false,
		source: asString(payload.source),
		languages,
		defaultLanguage:
			asString(payload.default_language) ?? asString(payload.defaultLanguage) ?? undefined,
		audioPath,
		directUpload: asBoolean(payload.direct_upload ?? payload.directUpload) ?? false,
		maxBytes: asNumber(payload.max_bytes ?? payload.maxBytes) ?? undefined,
		raw: payload,
	};
}

function normalizeTranscriptionPayload(payload: unknown): DocsieTranscriptionResult {
	if (!isRecord(payload)) {
		return {
			success: false,
			segments: [],
			error: "Unexpected Docsie transcription response",
		};
	}

	return {
		success: payload.success !== false,
		filename: asString(payload.filename),
		contentType: asNullableString(payload.content_type) ?? asNullableString(payload.contentType),
		language: asNullableString(payload.language),
		text: typeof payload.text === "string" ? payload.text : "",
		segments: Array.isArray(payload.segments) ? payload.segments : [],
		segmentCount: asNumber(payload.segment_count) ?? asNumber(payload.segmentCount) ?? undefined,
		durationSeconds:
			asNumber(payload.duration_seconds) ?? asNumber(payload.durationSeconds) ?? undefined,
		creditsCharged:
			asNumber(payload.credits_charged) ?? asNumber(payload.creditsCharged) ?? undefined,
		creditBalanceAfter:
			asNumber(payload.credit_balance_after) ?? asNumber(payload.creditBalanceAfter) ?? undefined,
		raw: payload,
		error:
			asNullableString(payload.error) ??
			asNullableString(payload.detail) ??
			asNullableString(payload.message) ??
			undefined,
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
		documentationId: asNullableString(payload.documentation_id),
		documentationName: asNullableString(payload.documentation_name),
		bookId: asNullableString(payload.book_id),
		bookName: asNullableString(payload.book_name),
		articleId: asNullableString(payload.article_id),
		articlesCreated: asNumber(payload.articles_created),
		url: asNullableString(payload.url),
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
	const explicitToken = asString(input.token);
	const storedToken = stored ? decryptToken(stored) : undefined;
	const hasGenerationTemplateInput = "defaultGenerationTemplateId" in input;
	const hasTargetDocumentationInput = "targetDocumentationId" in input;
	const hasOutputFormatsInput = "defaultOutputFormats" in input;
	const hasPptxOptionsInput = "defaultPptxOptions" in input;
	if (!explicitToken && storedToken && stored?.apiBaseUrl) {
		const storedOrigin = new URL(stored.apiBaseUrl).origin;
		const nextOrigin = new URL(normalizedApiBaseUrl).origin;
		if (storedOrigin !== nextOrigin) {
			throw new Error("Log in again after changing Docsie environments.");
		}
	}

	const nextToken = explicitToken ?? storedToken;
	if (!nextToken) {
		throw new Error("Docsie API token is required");
	}

	const persisted: StoredDocsieConfig = {
		apiBaseUrl: normalizedApiBaseUrl,
		authMode: input.authMode,
		organizationId: asString(input.organizationId) ?? stored?.organizationId,
		organizationName: asString(input.organizationName) ?? stored?.organizationName,
		organizationSlug: asString(input.organizationSlug) ?? stored?.organizationSlug,
		workspaceId: asString(input.workspaceId),
		workspaceName: asString(input.workspaceName),
		defaultQuality: input.defaultQuality ?? stored?.defaultQuality ?? DEFAULT_QUALITY,
		defaultLanguage: asString(input.defaultLanguage) ?? stored?.defaultLanguage ?? DEFAULT_LANGUAGE,
		defaultDocStyle: input.defaultDocStyle ?? stored?.defaultDocStyle ?? DEFAULT_DOC_STYLE,
		defaultRewriteInstructions:
			asString(input.defaultRewriteInstructions) ?? stored?.defaultRewriteInstructions ?? "",
		defaultGenerationTemplateId: hasGenerationTemplateInput
			? (asString(input.defaultGenerationTemplateId) ?? "")
			: (stored?.defaultGenerationTemplateId ?? ""),
		defaultTemplateInstruction:
			asString(input.defaultTemplateInstruction) ?? stored?.defaultTemplateInstruction ?? "",
		targetDocumentationId: hasTargetDocumentationInput
			? (asString(input.targetDocumentationId) ?? undefined)
			: stored?.targetDocumentationId,
		autoGenerate: input.autoGenerate ?? stored?.autoGenerate ?? true,
		defaultOutputFormats: hasOutputFormatsInput
			? normalizeDocsieOutputFormats(input.defaultOutputFormats, DEFAULT_OUTPUT_FORMATS)
			: normalizeDocsieOutputFormats(stored?.defaultOutputFormats, DEFAULT_OUTPUT_FORMATS),
		defaultPptxOptions: hasPptxOptionsInput
			? normalizeDocsiePptxOptions(input.defaultPptxOptions)
			: normalizeDocsiePptxOptions(stored?.defaultPptxOptions),
		voiceApiEnabled: input.voiceApiEnabled ?? stored?.voiceApiEnabled ?? false,
		voiceOptionsPath: normalizeDocsieApiPath(
			input.voiceOptionsPath ?? stored?.voiceOptionsPath,
			DEFAULT_VOICE_OPTIONS_PATH,
		),
		voiceSpeechPath: normalizeDocsieApiPath(
			input.voiceSpeechPath ?? stored?.voiceSpeechPath,
			DEFAULT_VOICE_SPEECH_PATH,
		),
		defaultVoiceOptions: normalizeVoiceDefaultOptions(
			input.defaultVoiceOptions ?? stored?.defaultVoiceOptions,
		),
		transcriptionApiEnabled:
			input.transcriptionApiEnabled ?? stored?.transcriptionApiEnabled ?? false,
		transcriptionOptionsPath: normalizeDocsieApiPath(
			input.transcriptionOptionsPath ?? stored?.transcriptionOptionsPath,
			DEFAULT_TRANSCRIPTION_OPTIONS_PATH,
		),
		transcriptionAudioPath: normalizeDocsieApiPath(
			input.transcriptionAudioPath ?? stored?.transcriptionAudioPath,
			DEFAULT_TRANSCRIPTION_AUDIO_PATH,
		),
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

export async function listDocsieDocumentationShelves(
	input: DocsieListDocumentationShelvesInput = {},
): Promise<DocsieDocumentationShelf[]> {
	const config = await resolveDocsieConfig();
	const workspaceId = asString(input.workspaceId) ?? config.workspaceId;
	const params = new URLSearchParams({ deleted: "false" });
	if (workspaceId) {
		params.set("workspace", workspaceId);
	}
	const payload = await docsieJsonRequest(config, `/documentation/?${params.toString()}`);
	return normalizeDocumentationShelfPayload(payload);
}

export async function listDocsieGenerationTemplates(): Promise<DocsieGenerationTemplate[]> {
	const config = await resolveDocsieConfig();
	const payload = await docsieJsonRequest(config, "/video-to-docs/templates/");
	return normalizeGenerationTemplatePayload(payload);
}

export async function listDocsieVoiceOptions(
	input: DocsieListVoiceOptionsInput = {},
): Promise<DocsieVoiceOptionsResult> {
	try {
		const config = await resolveDocsieConfig();
		const requestPath = buildDocsiePathWithQuery(config.voiceOptionsPath, {
			provider: asString(input.provider),
			tier: asString(input.tier),
		});
		const payload = await docsieJsonRequest(config, requestPath);
		return normalizeVoiceOptionsPayload(payload, config.defaultVoiceOptions);
	} catch (error) {
		return {
			success: false,
			tiers: [],
			providers: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function listDocsieTranscriptionOptions(): Promise<DocsieTranscriptionOptionsResult> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, config.transcriptionOptionsPath);
		return normalizeTranscriptionOptionsPayload(payload);
	} catch (error) {
		return {
			success: false,
			languages: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function transcribeDocsieAudio(
	input: DocsieTranscribeAudioInput,
): Promise<DocsieTranscriptionResult> {
	try {
		const config = await resolveDocsieConfig();
		const fileName = asString(input.fileName) ?? `screen-recorder-audio-${Date.now()}.webm`;
		const contentType = asString(input.contentType) ?? "audio/webm";
		if (!input.audioData || input.audioData.byteLength === 0) {
			throw new Error("Extracted audio is empty");
		}

		const audioBuffer = Buffer.from(input.audioData);
		const uploadPayload = await docsieJsonRequest(config, config.transcriptionAudioPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				filename: fileName,
				content_type: contentType,
				file_size: audioBuffer.byteLength,
			}),
		});
		if (!isRecord(uploadPayload)) {
			throw new Error("Docsie did not return a transcription upload URL");
		}

		const uploadUrl = asString(uploadPayload.upload_url) ?? asString(uploadPayload.url);
		const uploadKey = asString(uploadPayload.upload_key) ?? asString(uploadPayload.key);
		if (!uploadUrl || !uploadKey) {
			throw new Error("Docsie transcription upload response was incomplete");
		}

		await uploadBinaryToPresignedUrl(uploadUrl, contentType, audioBuffer);

		const body: Record<string, unknown> = {
			upload_key: uploadKey,
			filename: fileName,
			content_type: contentType,
			file_size: audioBuffer.byteLength,
		};
		const language = asString(input.language);
		if (language && language.toLowerCase() !== "auto") {
			body.language = language;
		}

		const payload = await docsieJsonRequest(config, config.transcriptionAudioPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});
		return normalizeTranscriptionPayload(payload);
	} catch (error) {
		return {
			success: false,
			segments: [],
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function generateDocsieVoiceover(
	input: DocsieGenerateVoiceoverInput,
): Promise<DocsieGenerateVoiceoverResult> {
	try {
		const config = await resolveDocsieConfig();
		const text = asString(input.text);
		if (!text) {
			throw new Error("Voiceover text is required");
		}

		const body: Record<string, unknown> = {
			...normalizeVoiceDefaultOptions(config.defaultVoiceOptions),
			...normalizeVoiceDefaultOptions(input.options),
			text,
		};
		const provider = asString(input.provider);
		const voiceId = asString(input.voiceId);
		const responseFormat = asString(input.responseFormat);
		const filename = asString(input.filename);

		if (provider) {
			body.provider = provider;
		} else {
			delete body.provider;
		}
		if (voiceId) body.voice_id = voiceId;
		if (responseFormat) body.response_format = responseFormat;
		if (typeof input.speed === "number" && Number.isFinite(input.speed)) {
			body.speed = input.speed;
		}
		if (filename) body.filename = filename;

		const { buffer, headers } = await docsieBinaryRequest(config, config.voiceSpeechPath, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		const contentType = headers.get("content-type");
		const responseFilename = parseContentDispositionFilename(headers.get("content-disposition"));
		const outputFilename = normalizeAudioFilename(responseFilename ?? filename, contentType);
		await fs.mkdir(DOCSIE_VOICEOVER_DIR, { recursive: true });
		const outputPath = path.join(DOCSIE_VOICEOVER_DIR, outputFilename);
		await fs.writeFile(outputPath, buffer);

		return {
			success: true,
			audioFilePath: outputPath,
			audioFileUrl: pathToFileURL(outputPath).toString(),
			filename: outputFilename,
			contentType,
			provider: headers.get("x-voice-provider"),
			model: headers.get("x-voice-model"),
			voiceName: headers.get("x-voice-name"),
			source: headers.get("x-voice-source"),
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function getDocsieCreditBalance(): Promise<DocsieCreditBalanceResult> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, "/credits/balance/");
		return {
			success: true,
			balance: normalizeCreditBalancePayload(payload),
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export async function connectDocsieDesktopHandoff(
	input: DocsieDesktopHandoffInput,
): Promise<DocsieDesktopHandoffExchangeResult> {
	try {
		const requestApiBaseUrl = normalizeDocsieApiBaseUrl(input.apiBaseUrl);
		const response = await fetch(`${requestApiBaseUrl}/desktop-auth/handoffs/exchange/`, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				handoff_id: input.handoffId,
				state: input.state,
				device_name: input.deviceName ?? app.getName(),
			}),
		});

		const contentType = response.headers.get("content-type") ?? "";
		const payload = contentType.includes("application/json")
			? await response.json()
			: await response.text();

		if (!response.ok || !isRecord(payload)) {
			const message = isRecord(payload)
				? (asString(payload.detail) ?? asString(payload.error) ?? asString(payload.message))
				: typeof payload === "string"
					? payload
					: null;
			throw new Error(message ?? `Docsie desktop auth failed (${response.status})`);
		}

		const accessToken = asString(payload.access_token);
		if (!accessToken) {
			throw new Error("Docsie desktop auth did not return an access token");
		}

		const apiBaseUrl = normalizeDocsieApiBaseUrl(
			asString(payload.api_base_url) ?? requestApiBaseUrl,
		);
		const persisted: StoredDocsieConfig = {
			apiBaseUrl,
			authMode: "bearer",
			organizationId: asString(payload.organization_id),
			organizationName: asString(payload.organization_name),
			organizationSlug: asString(payload.organization_slug) ?? asString(payload.organizationSlug),
			workspaceId: asString(payload.workspace_id),
			workspaceName: asString(payload.workspace_name),
			defaultQuality: asString(payload.default_quality) ?? DEFAULT_QUALITY,
			defaultLanguage: asString(payload.default_language) ?? DEFAULT_LANGUAGE,
			defaultDocStyle: asString(payload.default_doc_style) ?? DEFAULT_DOC_STYLE,
			defaultRewriteInstructions: asString(payload.default_rewrite_instructions) ?? "",
			defaultGenerationTemplateId: asString(payload.default_generation_template_id) ?? "",
			defaultTemplateInstruction: asString(payload.default_template_instruction) ?? "",
			targetDocumentationId: asString(payload.target_documentation_id),
			autoGenerate: typeof payload.auto_generate === "boolean" ? payload.auto_generate : true,
			defaultOutputFormats: normalizeDocsieOutputFormats(
				payload.default_output_formats,
				DEFAULT_OUTPUT_FORMATS,
			),
			defaultPptxOptions: normalizeDocsiePptxOptions(payload.default_pptx_options),
			voiceApiEnabled: asBoolean(payload.voice_api_enabled) ?? false,
			voiceOptionsPath: normalizeDocsieApiPath(
				payload.voice_options_path,
				DEFAULT_VOICE_OPTIONS_PATH,
			),
			voiceSpeechPath: normalizeDocsieApiPath(payload.voice_speech_path, DEFAULT_VOICE_SPEECH_PATH),
			defaultVoiceOptions: normalizeVoiceDefaultOptions(payload.default_voice_options),
			transcriptionApiEnabled: asBoolean(payload.transcription_api_enabled) ?? false,
			transcriptionOptionsPath: normalizeDocsieApiPath(
				payload.transcription_options_path,
				DEFAULT_TRANSCRIPTION_OPTIONS_PATH,
			),
			transcriptionAudioPath: normalizeDocsieApiPath(
				payload.transcription_audio_path,
				DEFAULT_TRANSCRIPTION_AUDIO_PATH,
			),
			...encryptToken(accessToken),
		};

		await fs.writeFile(DOCSIE_CONFIG_PATH, JSON.stringify(persisted, null, 2), "utf-8");
		const nextState = toDocsieState(persisted);

		return {
			success: true,
			state: nextState,
			organizationId: persisted.organizationId,
			organizationName: persisted.organizationName,
			organizationSlug: persisted.organizationSlug,
			workspaceId: persisted.workspaceId ?? null,
			workspaceName: persisted.workspaceName ?? null,
			returnUrl: asNullableString(payload.return_url),
			expiresAt: asString(payload.expires_at),
			message: "Docsie Screen Recorder is connected.",
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function normalizeGenerateResult(payload: unknown): DocsieGenerateVideoToDocsResult {
	if (!isRecord(payload)) {
		return { success: false, error: "Unexpected Docsie generate response" };
	}

	return {
		success: true,
		jobId: asString(payload.job_id),
		generateJobId: asString(payload.generate_job_id),
		status: asString(payload.status),
		docStyle:
			(asString(payload.doc_style) as DocsieGenerateVideoToDocsResult["docStyle"]) ?? undefined,
	};
}

function normalizeAsyncJobResult(payload: unknown): DocsieAsyncJobResult {
	if (!isRecord(payload)) {
		return { success: false, error: "Unexpected Docsie job response" };
	}

	return {
		success: true,
		jobId: asString(payload.id),
		status: asString(payload.status),
		result: isRecord(payload.result) ? payload.result : null,
	};
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
				...(asString(input.workspaceId) ? { workspace_id: asString(input.workspaceId) } : {}),
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
		const defaultBookTitle = path.parse(normalizedVideoPath).name || "Video Documentation";
		const remoteName = sanitizeFilenameSegment(
			`docsie-screen-${Date.now()}-${basename || `recording${path.extname(normalizedVideoPath)}`}`,
		);
		const generationTemplateId =
			asString(input.generationTemplateId) ?? config.defaultGenerationTemplateId ?? "";
		const templateInstruction = generationTemplateId
			? ""
			: (asString(input.templateInstruction) ?? config.defaultTemplateInstruction ?? "");
		const outputFormats = normalizeDocsieOutputFormats(
			input.outputFormats,
			config.defaultOutputFormats,
		);
		const pptxOptions = normalizeDocsiePptxOptions(input.pptxOptions ?? config.defaultPptxOptions);

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
				rewrite_instructions:
					asString(input.rewriteInstructions) ?? config.defaultRewriteInstructions ?? "",
				generation_template_id: generationTemplateId,
				template_instruction: templateInstruction,
				target_documentation_id:
					asString(input.targetDocumentationId) ?? config.targetDocumentationId ?? "",
				book_title: asString(input.bookTitle) ?? defaultBookTitle,
				auto_generate: input.autoGenerate ?? config.autoGenerate,
				output_formats: outputFormats,
				...(hasPptxOutput(outputFormats) && Object.keys(pptxOptions).length
					? { pptx_options: pptxOptions }
					: {}),
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

export async function generateDocsieVideoToDocs(
	input: DocsieGenerateVideoToDocsInput,
): Promise<DocsieGenerateVideoToDocsResult> {
	try {
		const config = await resolveDocsieConfig();
		const jobId = asString(input.jobId);
		if (!jobId) {
			throw new Error("Docsie analysis job ID is required");
		}
		const generationTemplateId =
			asString(input.generationTemplateId) ?? config.defaultGenerationTemplateId ?? "";
		const templateInstruction = generationTemplateId
			? ""
			: (asString(input.templateInstruction) ?? config.defaultTemplateInstruction ?? "");
		const outputFormats = normalizeDocsieOutputFormats(
			input.outputFormats,
			config.defaultOutputFormats,
		);
		const pptxOptions = normalizeDocsiePptxOptions(input.pptxOptions ?? config.defaultPptxOptions);

		const payload = await docsieJsonRequest(config, `/video-to-docs/${jobId}/generate/`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				doc_style: input.docStyle ?? config.defaultDocStyle,
				rewrite_instructions:
					asString(input.rewriteInstructions) ?? config.defaultRewriteInstructions ?? "",
				generation_template_id: generationTemplateId,
				template_instruction: templateInstruction,
				target_language: asString(input.targetLanguage) ?? config.defaultLanguage,
				target_documentation_id:
					asString(input.targetDocumentationId) ?? config.targetDocumentationId ?? "",
				book_title: asString(input.bookTitle) ?? "Video Documentation",
				output_formats: outputFormats,
				...(hasPptxOutput(outputFormats) && Object.keys(pptxOptions).length
					? { pptx_options: pptxOptions }
					: {}),
			}),
		});

		return normalizeGenerateResult(payload);
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

export async function listDocsieVideoToDocsHistory(
	videoPath: string,
): Promise<DocsieVideoToDocsHistoryEntry[]> {
	const history = await readDocsieVideoToDocsHistory();
	return history.entriesByVideoPath[normalizeVideoHistoryPath(videoPath)] ?? [];
}

export async function saveDocsieVideoToDocsHistory(
	input: DocsieSaveVideoToDocsHistoryInput,
): Promise<DocsieVideoToDocsHistoryEntry> {
	const config = await resolveDocsieConfig();
	const history = await readDocsieVideoToDocsHistory();
	const normalizedVideoPath = normalizeVideoHistoryPath(input.videoPath);
	const createdAt = new Date().toISOString();

	const nextEntry: DocsieVideoToDocsHistoryEntry = {
		id: `docsie-v2d-${Date.now()}`,
		videoPath: normalizedVideoPath,
		videoName: asString(input.videoName) ?? path.basename(normalizedVideoPath),
		createdAt,
		organizationName: config.organizationName,
		workspaceId: asString(input.jobResult.workspaceId) ?? config.workspaceId,
		workspaceName: config.workspaceName,
		quality: input.quality,
		language: asString(input.language) ?? config.defaultLanguage,
		docStyle: input.docStyle,
		bookTitle: asString(input.bookTitle),
		targetDocumentationId: asString(input.targetDocumentationId),
		generationTemplateId: asString(input.generationTemplateId),
		generationTemplateName: asString(input.generationTemplateName),
		templateInstruction: asString(input.templateInstruction),
		rewriteInstructions: asString(input.rewriteInstructions),
		outputFormats: input.outputFormats,
		pptxOptions: input.pptxOptions,
		analysisJobId: asString(input.analysisJobId),
		generationJobId: asString(input.generationJobId),
		jobResult: input.jobResult,
	};

	const existing = history.entriesByVideoPath[normalizedVideoPath] ?? [];
	const deduped = existing.filter((entry) => {
		const existingResultId = asString(entry.jobResult.jobId);
		const nextResultId = asString(nextEntry.jobResult.jobId);
		if (existingResultId && nextResultId && existingResultId === nextResultId) {
			return false;
		}
		return entry.id !== nextEntry.id;
	});

	history.entriesByVideoPath[normalizedVideoPath] = [nextEntry, ...deduped].slice(
		0,
		MAX_HISTORY_PER_VIDEO,
	);
	await writeDocsieVideoToDocsHistory(history);
	return nextEntry;
}

export async function getDocsieBackgroundJob(jobId: string): Promise<DocsieAsyncJobResult> {
	try {
		const config = await resolveDocsieConfig();
		const payload = await docsieJsonRequest(config, `/jobs/${jobId}/`);
		return normalizeAsyncJobResult(payload);
	} catch (error) {
		return {
			success: false,
			jobId,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
