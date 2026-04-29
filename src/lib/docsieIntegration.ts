export type DocsieAuthMode = "apiKey" | "bearer";
export type DocsieVideoToDocsQuality = "draft" | "standard" | "detailed" | "ultra";
export type DocsieOutputFormat = "md" | "docx" | "pdf";
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

export interface DocsieWorkspace {
	id: string;
	name: string;
	slug?: string;
	documentationId?: string | null;
}

export interface DocsieDesktopConnectParams {
	workspaceId?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	templateInstruction?: string;
	rewriteInstructions?: string;
	targetDocumentationId?: string;
	autoGenerate?: boolean;
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
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality?: DocsieVideoToDocsQuality;
	defaultLanguage?: string;
	defaultDocStyle?: DocsieVideoToDocsDocStyle;
	defaultRewriteInstructions?: string;
	defaultTemplateInstruction?: string;
	targetDocumentationId?: string;
	autoGenerate?: boolean;
}

export interface DocsieIntegrationState {
	apiBaseUrl: string;
	authMode: DocsieAuthMode;
	hasToken: boolean;
	organizationId?: string;
	organizationName?: string;
	workspaceId?: string;
	workspaceName?: string;
	defaultQuality: DocsieVideoToDocsQuality;
	defaultLanguage: string;
	defaultDocStyle: DocsieVideoToDocsDocStyle;
	defaultRewriteInstructions?: string;
	defaultTemplateInstruction?: string;
	targetDocumentationId?: string;
	autoGenerate: boolean;
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
	workspaceName?: string | null;
	returnUrl?: string | null;
	error?: string;
}

export interface DocsieEstimateInput {
	quality: DocsieVideoToDocsQuality;
	durationSeconds?: number;
	durationMinutes?: number;
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

export interface DocsieStartVideoToDocsInput {
	videoPath: string;
	quality?: DocsieVideoToDocsQuality;
	language?: string;
	workspaceId?: string;
	docStyle?: DocsieVideoToDocsDocStyle;
	rewriteInstructions?: string;
	templateInstruction?: string;
	targetDocumentationId?: string;
	bookTitle?: string;
	autoGenerate?: boolean;
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
	templateInstruction?: string;
	targetLanguage?: string;
	targetDocumentationId?: string;
	bookTitle?: string;
	outputFormats?: DocsieOutputFormat[];
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
