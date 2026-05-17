export type DocsieAuthMode = "apiKey" | "bearer";
export type DocsieVideoToDocsQuality = "draft" | "standard" | "detailed" | "ultra";
export type DocsieOutputFormat = "md" | "docx" | "pdf" | "pptx";
export type DocsiePptxImageQuality = "low" | "medium" | "high";
export type DocsieVideoToDocsDocStyle =
	| "guide"
	| "sop"
	| "tutorial"
	| "how-to"
	| "blog"
	| "training"
	| "knowledge-base"
	| "release-notes"
	| "reference"
	| "product"
	| "policy";

export interface DocsiePptxOptions {
	deckType?: string;
	sourceName?: string;
	enhance?: string;
	audience?: string;
	maxSlides?: number;
	generateCoverImage?: boolean;
	imageQuality?: DocsiePptxImageQuality;
	illustrationStyle?: string;
	theme?: unknown;
	embedImages?: boolean;
}

export interface DocsieVoiceDefaultOptions {
	provider?: string;
	voice_id?: string;
	response_format?: string;
	speed?: number;
	[key: string]: unknown;
}

export interface DocsieVoiceOption {
	provider: string;
	id: string;
	name: string;
	tier?: string;
	model?: string;
	raw?: Record<string, unknown>;
}

export interface DocsieVoiceProvider {
	provider: string;
	configured: boolean;
	defaultModel?: string;
	voices: DocsieVoiceOption[];
	message?: string;
	raw?: Record<string, unknown>;
}

export interface DocsieVoiceOptionsResult {
	success: boolean;
	source?: string;
	preferredProvider?: string;
	tiers: string[];
	providers: DocsieVoiceProvider[];
	defaultVoiceOptions?: DocsieVoiceDefaultOptions;
	error?: string;
}

export interface DocsieListVoiceOptionsInput {
	provider?: string;
	tier?: string;
}

export interface DocsieGenerateVoiceoverInput {
	text: string;
	provider?: string;
	voiceId?: string;
	responseFormat?: string;
	speed?: number;
	filename?: string;
	options?: DocsieVoiceDefaultOptions;
}

export interface DocsieTranscriptionOption {
	code: string;
	name?: string;
	raw?: Record<string, unknown>;
}

export interface DocsieTranscriptionOptionsResult {
	success: boolean;
	source?: string;
	languages: DocsieTranscriptionOption[];
	defaultLanguage?: string;
	audioPath?: string;
	directUpload?: boolean;
	maxBytes?: number;
	raw?: Record<string, unknown>;
	error?: string;
}

export interface DocsieTranscribeAudioInput {
	audioData?: ArrayBuffer;
	audioPath?: string;
	fileName: string;
	contentType?: string;
	language?: string;
}

export interface DocsieTranscriptionResult {
	success: boolean;
	filename?: string;
	contentType?: string | null;
	language?: string | null;
	text?: string;
	segments: unknown[];
	segmentCount?: number;
	durationSeconds?: number;
	creditsCharged?: number;
	creditBalanceAfter?: number;
	raw?: Record<string, unknown>;
	error?: string;
}

export interface DocsieGenerateVoiceoverResult {
	success: boolean;
	audioFilePath?: string;
	audioFileUrl?: string;
	filename?: string;
	contentType?: string | null;
	provider?: string | null;
	model?: string | null;
	voiceName?: string | null;
	source?: string | null;
	error?: string;
}

export interface DocsieWorkspace {
	id: string;
	name: string;
	slug?: string;
	documentationId?: string | null;
}

export interface DocsieDocumentationShelf {
	id: string;
	name: string;
	slug?: string;
	workspaceId?: string | null;
	primary?: boolean;
	activeBooksCount?: number | null;
}

export interface DocsieGenerationTemplateOutlineItem {
	title: string;
	description?: string;
}

export interface DocsieGenerationTemplate {
	id: string;
	name: string;
	category: string;
	description?: string;
	icon?: string;
	preview?: string[];
	outline?: DocsieGenerationTemplateOutlineItem[];
	exampleMarkdown?: string;
	previewMarkdown?: string;
}

export interface DocsieDesktopConnectParams {
	workspaceId?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	generationTemplateId?: string;
	templateInstruction?: string;
	rewriteInstructions?: string;
	targetDocumentationId?: string;
	autoGenerate?: boolean;
	outputFormats?: DocsieOutputFormat[];
	pptxOptions?: DocsiePptxOptions;
}

export const DEFAULT_DOCSIE_WEB_APP_URL = "https://app.docsie.io";

export function getDocsieWebAppUrl(apiBaseUrl?: string | null) {
	const candidate = typeof apiBaseUrl === "string" ? apiBaseUrl.trim() : "";
	if (!candidate) {
		return DEFAULT_DOCSIE_WEB_APP_URL;
	}

	try {
		const parsed = new URL(candidate);
		const normalized = parsed.pathname.replace(/\/+$/, "");
		if (/\/api_v2\/(?:v3|003)$/.test(normalized)) {
			parsed.pathname = normalized.replace(/\/api_v2\/(?:v3|003)$/, "") || "/";
		}
		return parsed.toString().replace(/\/+$/, "");
	} catch {
		return DEFAULT_DOCSIE_WEB_APP_URL;
	}
}

export function buildDocsieDesktopConnectUrl(
	webAppUrl: string,
	params?: DocsieDesktopConnectParams,
) {
	const baseUrl = getDocsieWebAppUrl(webAppUrl);
	const connectUrl = new URL("/o2/screen-recorder/connect/", `${baseUrl}/`);

	if (params?.workspaceId?.trim()) {
		connectUrl.searchParams.set("workspace_id", params.workspaceId.trim());
	}
	if (params?.docStyle?.trim()) {
		connectUrl.searchParams.set("doc_style", params.docStyle.trim());
	}
	if (params?.quality?.trim()) {
		connectUrl.searchParams.set("quality", params.quality.trim());
	}
	if (params?.language?.trim()) {
		connectUrl.searchParams.set("language", params.language.trim());
	}
	if (params?.generationTemplateId?.trim()) {
		connectUrl.searchParams.set("generation_template_id", params.generationTemplateId.trim());
	}
	if (params?.templateInstruction?.trim()) {
		connectUrl.searchParams.set("template_instruction", params.templateInstruction.trim());
	}
	if (params?.rewriteInstructions?.trim()) {
		connectUrl.searchParams.set("rewrite_instructions", params.rewriteInstructions.trim());
	}
	if (params?.targetDocumentationId?.trim()) {
		connectUrl.searchParams.set("target_documentation_id", params.targetDocumentationId.trim());
	}
	if (typeof params?.autoGenerate === "boolean") {
		connectUrl.searchParams.set("auto_generate", params.autoGenerate ? "true" : "false");
	}
	if (params?.outputFormats?.length) {
		connectUrl.searchParams.set("output_formats", params.outputFormats.join(","));
	}
	if (params?.pptxOptions) {
		const options = params.pptxOptions;
		if (options.deckType?.trim()) {
			connectUrl.searchParams.set("pptx_deck_type", options.deckType.trim());
		}
		if (options.sourceName?.trim()) {
			connectUrl.searchParams.set("pptx_source_name", options.sourceName.trim());
		}
		if (options.enhance?.trim()) {
			connectUrl.searchParams.set("pptx_enhance", options.enhance.trim());
		}
		if (options.audience?.trim()) {
			connectUrl.searchParams.set("pptx_audience", options.audience.trim());
		}
		if (typeof options.maxSlides === "number" && Number.isFinite(options.maxSlides)) {
			connectUrl.searchParams.set("pptx_max_slides", String(options.maxSlides));
		}
		if (typeof options.generateCoverImage === "boolean") {
			connectUrl.searchParams.set(
				"pptx_generate_cover_image",
				options.generateCoverImage ? "true" : "false",
			);
		}
		if (options.imageQuality?.trim()) {
			connectUrl.searchParams.set("pptx_image_quality", options.imageQuality.trim());
		}
		if (options.illustrationStyle?.trim()) {
			connectUrl.searchParams.set("pptx_illustration_style", options.illustrationStyle.trim());
		}
		if (typeof options.embedImages === "boolean") {
			connectUrl.searchParams.set("pptx_embed_images", options.embedImages ? "true" : "false");
		}
	}

	return connectUrl.toString();
}

export function buildDocsieDesktopLoginUrl(webAppUrl: string, params?: DocsieDesktopConnectParams) {
	const baseUrl = getDocsieWebAppUrl(webAppUrl);
	const loginUrl = new URL("/onboarding/v3/login/", `${baseUrl}/`);
	loginUrl.searchParams.set("next", buildDocsieDesktopConnectUrl(baseUrl, params));
	return loginUrl.toString();
}

export function buildDocsieDesktopSignupUrl(
	webAppUrl: string,
	params?: DocsieDesktopConnectParams,
) {
	const baseUrl = getDocsieWebAppUrl(webAppUrl);
	const signupUrl = new URL("/onboarding/v3/", `${baseUrl}/`);
	signupUrl.searchParams.set("next", buildDocsieDesktopConnectUrl(baseUrl, params));
	return signupUrl.toString();
}

export interface DocsieIntegrationConfigInput {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	token?: string;
	organizationId?: string;
	organizationName?: string;
	organizationSlug?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality?: DocsieVideoToDocsQuality;
	defaultLanguage?: string;
	defaultDocStyle?: DocsieVideoToDocsDocStyle;
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

export interface DocsieIntegrationState {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	hasToken: boolean;
	organizationId?: string;
	organizationName?: string;
	organizationSlug?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality: DocsieVideoToDocsQuality;
	defaultLanguage: string;
	defaultDocStyle: DocsieVideoToDocsDocStyle;
	defaultRewriteInstructions?: string;
	defaultGenerationTemplateId?: string;
	defaultTemplateInstruction?: string;
	targetDocumentationId?: string;
	autoGenerate: boolean;
	defaultOutputFormats: DocsieOutputFormat[];
	defaultPptxOptions: DocsiePptxOptions;
	voiceApiEnabled: boolean;
	voiceOptionsPath?: string;
	voiceSpeechPath?: string;
	defaultVoiceOptions: DocsieVoiceDefaultOptions;
	transcriptionApiEnabled: boolean;
	transcriptionOptionsPath?: string;
	transcriptionAudioPath?: string;
}

export interface DocsieDesktopHandoffInput {
	handoffId: string;
	state: string;
	apiBaseUrl: string;
	deviceName?: string;
}

export interface DocsieDesktopHandoffExchangeResult {
	success: boolean;
	state?: DocsieIntegrationState;
	organizationId?: string;
	organizationName?: string;
	organizationSlug?: string;
	workspaceId?: string | null;
	workspaceName?: string | null;
	returnUrl?: string | null;
	expiresAt?: string;
	message?: string;
	error?: string;
}

export interface DocsieDesktopAuthEvent {
	status: "success" | "error";
	message: string;
	state?: DocsieIntegrationState;
	organizationName?: string;
	organizationSlug?: string;
	workspaceName?: string | null;
	returnUrl?: string | null;
	error?: string;
}

export interface DocsieEstimateInput {
	quality: DocsieVideoToDocsQuality;
	workspaceId?: string;
	durationSeconds?: number;
	durationMinutes?: number;
}

export interface DocsieListDocumentationShelvesInput {
	workspaceId?: string;
}

export interface DocsieEstimateResult {
	success: boolean;
	quality?: DocsieVideoToDocsQuality;
	secondsPerFrame?: number;
	creditsPerMinute?: number;
	durationMinutes?: number;
	estimate?: Record<string, unknown> | null;
	balance?: Record<string, unknown> | null;
	hasSufficientCredits?: boolean;
	error?: string;
}

export interface DocsieCreditBalance {
	monthlyAllocated?: number;
	monthlyUsed?: number;
	monthlyRemaining?: number;
	purchasedBalance?: number;
	totalAvailable?: number;
	monthlyResetsAt?: string | null;
	billingMode?: string;
	videoQualityTiers?: Record<string, unknown>;
	raw?: Record<string, unknown>;
}

export interface DocsieCreditBalanceResult {
	success: boolean;
	balance?: DocsieCreditBalance;
	error?: string;
}

export interface DocsieStartVideoToDocsInput {
	videoPath: string;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	workspaceId?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	rewriteInstructions?: string;
	generationTemplateId?: string;
	templateInstruction?: string;
	targetDocumentationId?: string;
	bookTitle?: string;
	autoGenerate?: boolean;
	outputFormats?: DocsieOutputFormat[];
	pptxOptions?: DocsiePptxOptions;
}

export interface DocsieStartVideoToDocsResult {
	success: boolean;
	jobId?: string;
	fileId?: string | null;
	workspaceId?: string | null;
	status?: string;
	quality?: DocsieVideoToDocsQuality;
	sourceType?: string | null;
	creditsPerMinute?: number;
	error?: string;
}

export interface DocsieGenerateVideoToDocsInput {
	jobId: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	rewriteInstructions?: string;
	generationTemplateId?: string;
	templateInstruction?: string;
	targetLanguage?: string;
	targetDocumentationId?: string;
	bookTitle?: string;
	outputFormats?: DocsieOutputFormat[];
	pptxOptions?: DocsiePptxOptions;
}

export interface DocsieGenerateVideoToDocsResult {
	success: boolean;
	jobId?: string;
	generateJobId?: string;
	status?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	error?: string;
}

export interface DocsieAsyncJobResult {
	success: boolean;
	jobId?: string;
	status?: string;
	result?: Record<string, unknown> | null;
	error?: string;
}

export interface DocsieVideoToDocsJobStatus {
	success: boolean;
	jobId?: string;
	status?: string;
	normalizedStatus?: string | null;
	workspaceId?: string | null;
	createdAt?: string | null;
	updatedAt?: string | null;
	sourceType?: string | null;
	sourceFileId?: string | null;
	sourceVideoUrl?: string | null;
	quality?: string | null;
	canPoll?: boolean;
	result?: Record<string, unknown> | null;
	error?: string | null;
}

export interface DocsieVideoToDocsJobResult {
	success: boolean;
	jobId?: string;
	status?: string;
	workspaceId?: string | null;
	sourceType?: string | null;
	sourceFileId?: string | null;
	sourceVideoUrl?: string | null;
	sessionId?: string | null;
	title?: string | null;
	style?: string | null;
	language?: string | null;
	markdown?: string;
	durationMinutes?: number | null;
	durationSeconds?: number | null;
	quality?: string | null;
	secondsPerFrame?: number | null;
	resultUrl?: string | null;
	transcription?: unknown;
	transcriptionRaw?: unknown;
	transcriptionUrl?: string | null;
	sections?: unknown[];
	images?: unknown[];
	documentationId?: string | null;
	documentationName?: string | null;
	bookId?: string | null;
	bookName?: string | null;
	articleId?: string | null;
	articlesCreated?: number | null;
	url?: string | null;
	creditsCharged?: number | null;
	creditBalanceAfter?: number | null;
	rehostedImages?: number | null;
	expiresInSeconds?: number | null;
	exports?: Record<string, unknown> | null;
	raw?: Record<string, unknown> | null;
	error?: string | null;
	message?: string | null;
}

export interface DocsieVideoToDocsHistoryEntry {
	id: string;
	videoPath: string;
	videoName: string;
	createdAt: string;
	organizationName?: string;
	workspaceId?: string;
	workspaceName?: string;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	bookTitle?: string;
	targetDocumentationId?: string;
	generationTemplateId?: string;
	generationTemplateName?: string;
	templateInstruction?: string;
	rewriteInstructions?: string;
	outputFormats?: DocsieOutputFormat[];
	pptxOptions?: DocsiePptxOptions;
	analysisJobId?: string;
	generationJobId?: string;
	jobResult: DocsieVideoToDocsJobResult;
}

export interface DocsieSaveVideoToDocsHistoryInput {
	videoPath: string;
	videoName?: string;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	bookTitle?: string;
	targetDocumentationId?: string;
	generationTemplateId?: string;
	generationTemplateName?: string;
	templateInstruction?: string;
	rewriteInstructions?: string;
	outputFormats?: DocsieOutputFormat[];
	pptxOptions?: DocsiePptxOptions;
	analysisJobId?: string;
	generationJobId?: string;
	jobResult: DocsieVideoToDocsJobResult;
}
