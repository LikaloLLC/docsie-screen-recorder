export type DocsieAuthMode = "apiKey" | "bearer";
export type DocsieVideoToDocsQuality = "draft" | "standard" | "detailed" | "ultra";
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
	creditsCharged?: number | null;
	creditBalanceAfter?: number | null;
	rehostedImages?: number | null;
	expiresInSeconds?: number | null;
	exports?: Record<string, unknown> | null;
	raw?: Record<string, unknown> | null;
	error?: string | null;
	message?: string | null;
}
