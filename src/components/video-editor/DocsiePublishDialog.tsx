import {
	CheckCircle2,
	Copy,
	Download,
	ExternalLink,
	FileText,
	Loader2,
	LogIn,
	Presentation,
	RefreshCcw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { DocsieTemplatePicker } from "@/components/video-editor/DocsieTemplatePicker";
import type {
	DocsieAuthMode,
	DocsieCreditBalance,
	DocsieDocumentationShelf,
	DocsieEstimateResult,
	DocsieGenerationTemplate,
	DocsieIntegrationState,
	DocsieOutputFormat,
	DocsiePptxImageQuality,
	DocsiePptxOptions,
	DocsieVideoToDocsDocStyle,
	DocsieVideoToDocsHistoryEntry,
	DocsieVideoToDocsIntent,
	DocsieVideoToDocsJobResult,
	DocsieVideoToDocsJobStatus,
	DocsieVideoToDocsQuality,
	DocsieWorkspace,
} from "@/lib/docsieIntegration";
import {
	buildDocsieDesktopConnectUrl,
	buildDocsieDesktopSignupUrl,
	getDocsieWebAppUrl,
} from "@/lib/docsieIntegration";
import { cn } from "@/lib/utils";

const QUALITY_OPTIONS: Array<{
	value: DocsieVideoToDocsQuality;
	label: string;
	description: string;
}> = [
	{ value: "draft", label: "Draft", description: "250 credits/min" },
	{ value: "standard", label: "Standard", description: "500 credits/min" },
	{ value: "detailed", label: "Detailed", description: "1,000 credits/min" },
	{ value: "ultra", label: "Ultra", description: "2,000 credits/min" },
];

const DOC_STYLE_OPTIONS: DocsieVideoToDocsDocStyle[] = [
	"guide",
	"sop",
	"tutorial",
	"how-to",
	"blog",
	"training",
	"knowledge-base",
	"release-notes",
	"reference",
	"product",
	"policy",
];

const DOCS_OUTPUT_FORMATS: DocsieOutputFormat[] = ["md", "docx", "pdf"];
const PRESENTATION_OUTPUT_FORMATS: DocsieOutputFormat[] = ["md", "pptx"];
const EXPORT_FORMATS = ["docx", "pdf", "pptx"] as const;
const STATUS_MESSAGE_MAX_LENGTH = 360;
const DEFAULT_PPTX_MAX_SLIDES = 12;

type PublishPhase = "idle" | "starting" | "analysis" | "generation" | "completed" | "failed";
type DocsieArtifactMode = "docs" | "presentation";
type ExportFormat = (typeof EXPORT_FORMATS)[number];
type ExportArtifactStatus = "queued" | "processing" | "ready" | "failed";

interface ExportArtifact {
	format: ExportFormat;
	status: ExportArtifactStatus;
	jobId?: string;
	url?: string;
	filename?: string;
	error?: string;
}

interface DocsiePublishDialogProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	videoPath: string | null;
	videoDurationSeconds?: number;
	onCreditsChanged?: () => void | Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatJobPhase(phase: PublishPhase) {
	switch (phase) {
		case "starting":
			return "Starting conversion";
		case "analysis":
			return "Analyzing video";
		case "generation":
			return "Generating docs";
		case "completed":
			return "Completed";
		case "failed":
			return "Failed";
		default:
			return "Ready";
	}
}

function formatStatusMessage(value: string) {
	const title = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
	const htmlStripped = (title ?? value)
		.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
		.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/\s+/g, " ")
		.trim();

	return htmlStripped.length > STATUS_MESSAGE_MAX_LENGTH
		? `${htmlStripped.slice(0, STATUS_MESSAGE_MAX_LENGTH - 1)}…`
		: htmlStripped;
}

function formatDuration(value?: number) {
	if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
		return "Unknown";
	}

	if (value < 60) {
		return `${value.toFixed(1)}s`;
	}

	const minutes = Math.floor(value / 60);
	const seconds = Math.round(value % 60);
	return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

function formatSecondsPerFrame(value?: number | null) {
	if (typeof value !== "number" || Number.isNaN(value) || value <= 0) {
		return null;
	}

	return value >= 1 ? `Every ${value.toFixed(value >= 10 ? 0 : 1)}s` : `Every ${value.toFixed(2)}s`;
}

function estimateFrameCount(durationSeconds?: number, secondsPerFrame?: number | null) {
	if (
		typeof durationSeconds !== "number" ||
		durationSeconds <= 0 ||
		typeof secondsPerFrame !== "number" ||
		secondsPerFrame <= 0
	) {
		return null;
	}

	return Math.max(1, Math.round(durationSeconds / secondsPerFrame));
}

function getEstimateText(estimate: DocsieEstimateResult | null) {
	if (!estimate?.success) {
		return null;
	}

	const credits = isRecord(estimate.estimate)
		? (estimate.estimate.total_credits ?? estimate.estimate.credits ?? null)
		: null;
	return typeof credits === "number" ? `${credits.toLocaleString()} credits` : null;
}

function getCreditBalanceText(balance: DocsieCreditBalance | null) {
	if (typeof balance?.totalAvailable !== "number") {
		return null;
	}

	return `${balance.totalAvailable.toLocaleString()} credits available`;
}

function getCreditBalanceDetail(balance: DocsieCreditBalance | null) {
	if (!balance) {
		return null;
	}

	const parts = [
		typeof balance.monthlyRemaining === "number"
			? `${balance.monthlyRemaining.toLocaleString()} monthly`
			: null,
		typeof balance.purchasedBalance === "number"
			? `${balance.purchasedBalance.toLocaleString()} purchased`
			: null,
	];

	return parts.filter(Boolean).join(" • ") || null;
}

function buildDefaultBookTitle(videoPath: string | null) {
	if (!videoPath) {
		return "Video Documentation";
	}

	const basename = videoPath.split("/").pop() ?? "Video Documentation";
	return basename.replace(/\.[^.]+$/, "") || "Video Documentation";
}

function buildApiBaseUrl(webAppUrl: string, currentApiBaseUrl: string) {
	const current = currentApiBaseUrl.trim();
	if (current) {
		return current;
	}

	const base = getDocsieWebAppUrl(webAppUrl);
	return new URL("/api_v2/003", `${base}/`).toString().replace(/\/+$/, "");
}

function buildDesktopAuthWebAppUrl(webAppUrl: string, currentApiBaseUrl: string) {
	const current = currentApiBaseUrl.trim();
	return getDocsieWebAppUrl(current || webAppUrl);
}

function getPrimaryResultUrl(jobResult: DocsieVideoToDocsJobResult | null) {
	return jobResult?.url ?? jobResult?.resultUrl ?? null;
}

function getResultTitle(jobResult: DocsieVideoToDocsJobResult | null) {
	return jobResult?.bookName ?? jobResult?.title ?? "Docsie result";
}

function normalizeMarkdownFileName(title: string) {
	return `${title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "docsie-result"}.md`;
}

function isExportFormat(format: DocsieOutputFormat): format is ExportFormat {
	return format !== "md";
}

function getOutputFormatsForMode(mode: DocsieArtifactMode): DocsieOutputFormat[] {
	return mode === "presentation" ? PRESENTATION_OUTPUT_FORMATS : DOCS_OUTPUT_FORMATS;
}

function getArtifactModeFromOutputFormats(
	outputFormats: DocsieOutputFormat[] | undefined,
): DocsieArtifactMode {
	if (
		outputFormats?.includes("pptx") &&
		!outputFormats.includes("docx") &&
		!outputFormats.includes("pdf")
	) {
		return "presentation";
	}
	return "docs";
}

function getDocStyleForArtifactMode(
	mode: DocsieArtifactMode,
	docStyle: DocsieVideoToDocsDocStyle,
	pptxDeckType: string,
): DocsieVideoToDocsDocStyle {
	if (mode === "docs") {
		return docStyle;
	}

	const deckType = pptxDeckType.trim();
	return DOC_STYLE_OPTIONS.includes(deckType as DocsieVideoToDocsDocStyle)
		? (deckType as DocsieVideoToDocsDocStyle)
		: "training";
}

function normalizePptxMaxSlides(value: string | number | undefined | null) {
	const numericValue = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
	if (!Number.isFinite(numericValue)) {
		return DEFAULT_PPTX_MAX_SLIDES;
	}
	return Math.min(100, Math.max(1, Math.round(numericValue)));
}

function getDocsiePersistenceLabel(jobResult: DocsieVideoToDocsJobResult | null) {
	return [jobResult?.documentationName ?? jobResult?.bookName ?? null, jobResult?.articleId ?? null]
		.filter(Boolean)
		.join(" • ");
}

function getResultHistoryKey(jobResult: DocsieVideoToDocsJobResult | null | undefined) {
	return (
		asString(jobResult?.jobId) ??
		asString(jobResult?.articleId) ??
		asString(jobResult?.url) ??
		asString(jobResult?.resultUrl) ??
		asString(jobResult?.bookId) ??
		asString(jobResult?.documentationId) ??
		null
	);
}

function getHistoryEntryKey(entry: DocsieVideoToDocsHistoryEntry) {
	const fallbackKey = [
		entry.videoPath,
		entry.bookTitle,
		entry.generationTemplateId,
		entry.targetDocumentationId,
		entry.createdAt,
	]
		.filter(Boolean)
		.join("::");

	return getResultHistoryKey(entry.jobResult) ?? (fallbackKey || entry.id);
}

function dedupeHistoryEntries(entries: DocsieVideoToDocsHistoryEntry[]) {
	const seen = new Set<string>();
	const deduped: DocsieVideoToDocsHistoryEntry[] = [];

	for (const entry of entries) {
		const key = getHistoryEntryKey(entry);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		deduped.push(entry);
	}

	return deduped;
}

function formatHistoryDate(value: string) {
	try {
		return new Date(value).toLocaleString();
	} catch {
		return value;
	}
}

function normalizeExportArtifacts(
	payload: Record<string, unknown> | null | undefined,
): Partial<Record<ExportFormat, ExportArtifact>> {
	const next: Partial<Record<ExportFormat, ExportArtifact>> = {};

	if (!payload) {
		return next;
	}

	for (const format of EXPORT_FORMATS) {
		const rawEntry = payload[format];
		if (!isRecord(rawEntry)) {
			continue;
		}

		const url = asString(rawEntry.url) ?? undefined;
		const jobId = asString(rawEntry.job_id) ?? undefined;
		const error = asString(rawEntry.error) ?? undefined;
		const rawStatus = asString(rawEntry.status)?.toLowerCase() ?? "";

		let status: ExportArtifactStatus = "queued";
		if (url) {
			status = "ready";
		} else if (rawStatus === "failed_to_start" || rawStatus === "failed" || error) {
			status = "failed";
		} else if (jobId) {
			status = "processing";
		}

		next[format] = {
			format,
			status,
			jobId,
			url,
			filename: asString(rawEntry.filename) ?? undefined,
			error,
		};
	}

	return next;
}

function getExportLabel(format: ExportFormat) {
	if (format === "pptx") {
		return "PowerPoint";
	}
	return format.toUpperCase();
}

export function DocsiePublishDialog({
	isOpen,
	onOpenChange,
	videoPath,
	videoDurationSeconds,
	onCreditsChanged,
}: DocsiePublishDialogProps) {
	const [apiBaseUrl, setApiBaseUrl] = useState("");
	const [webAppUrl, setWebAppUrl] = useState(getDocsieWebAppUrl(""));
	const [authMode, setAuthMode] = useState<DocsieAuthMode>("bearer");
	const [tokenInput, setTokenInput] = useState("");
	const [hasStoredToken, setHasStoredToken] = useState(false);
	const [organizationName, setOrganizationName] = useState("");
	const [storedWorkspaceName, setStoredWorkspaceName] = useState("");
	const [workspaceId, setWorkspaceId] = useState("");
	const [quality, setQuality] = useState<DocsieVideoToDocsQuality>("standard");
	const [language, setLanguage] = useState("english");
	const [docStyle, setDocStyle] = useState<DocsieVideoToDocsDocStyle>("guide");
	const [artifactMode, setArtifactMode] = useState<DocsieArtifactMode>("docs");
	const [autoGenerate, setAutoGenerate] = useState(true);
	const [rewriteInstructions, setRewriteInstructions] = useState("");
	const [generationTemplateId, setGenerationTemplateId] = useState("");
	const [templateInstruction, setTemplateInstruction] = useState("");
	const [pptxDeckType, setPptxDeckType] = useState("training");
	const [pptxSourceName, setPptxSourceName] = useState("Screen Recorder");
	const [pptxEnhance, setPptxEnhance] = useState("required");
	const [pptxAudience, setPptxAudience] = useState("");
	const [pptxMaxSlides, setPptxMaxSlides] = useState(String(DEFAULT_PPTX_MAX_SLIDES));
	const [pptxGenerateCoverImage, setPptxGenerateCoverImage] = useState(true);
	const [pptxImageQuality, setPptxImageQuality] = useState<DocsiePptxImageQuality>("medium");
	const [pptxIllustrationStyle, setPptxIllustrationStyle] = useState("corporate");
	const [pptxEmbedImages, setPptxEmbedImages] = useState(true);
	const [intent, setIntent] = useState<DocsieVideoToDocsIntent>("documentation");
	const [autoPublishToKnowledgeBase, setAutoPublishToKnowledgeBase] = useState(true);
	const [targetDocumentationId, setTargetDocumentationId] = useState("");
	const [bookTitle, setBookTitle] = useState("Video Documentation");
	const [workspaces, setWorkspaces] = useState<DocsieWorkspace[]>([]);
	const [documentationShelves, setDocumentationShelves] = useState<DocsieDocumentationShelf[]>([]);
	const [generationTemplates, setGenerationTemplates] = useState<DocsieGenerationTemplate[]>([]);
	const [savingConfig, setSavingConfig] = useState(false);
	const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
	const [loadingShelves, setLoadingShelves] = useState(false);
	const [loadingTemplates, setLoadingTemplates] = useState(false);
	const [loadingEstimate, setLoadingEstimate] = useState(false);
	const [estimate, setEstimate] = useState<DocsieEstimateResult | null>(null);
	const [creditBalance, setCreditBalance] = useState<DocsieCreditBalance | null>(null);
	const [loadingCreditBalance, setLoadingCreditBalance] = useState(false);
	const [phase, setPhase] = useState<PublishPhase>("idle");
	const [analysisJobId, setAnalysisJobId] = useState<string | null>(null);
	const [generationJobId, setGenerationJobId] = useState<string | null>(null);
	const [activeJobId, setActiveJobId] = useState<string | null>(null);
	const [jobStatus, setJobStatus] = useState<DocsieVideoToDocsJobStatus | null>(null);
	const [jobResult, setJobResult] = useState<DocsieVideoToDocsJobResult | null>(null);
	const [busyMessage, setBusyMessage] = useState<string | null>(null);
	const [exportArtifacts, setExportArtifacts] = useState<
		Partial<Record<ExportFormat, ExportArtifact>>
	>({});
	const [historyEntries, setHistoryEntries] = useState<DocsieVideoToDocsHistoryEntry[]>([]);
	const [showSettingsDialog, setShowSettingsDialog] = useState(false);
	const savedHistoryKeysRef = useRef<Set<string>>(new Set());

	const selectedWorkspace = useMemo(
		() => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
		[workspaceId, workspaces],
	);
	const selectedDocumentationShelf = useMemo(
		() => documentationShelves.find((shelf) => shelf.id === targetDocumentationId) ?? null,
		[documentationShelves, targetDocumentationId],
	);
	const selectedGenerationTemplate = useMemo(
		() => generationTemplates.find((template) => template.id === generationTemplateId) ?? null,
		[generationTemplateId, generationTemplates],
	);
	const requestedOutputFormats = useMemo(
		() => getOutputFormatsForMode(artifactMode),
		[artifactMode],
	);
	const requestedExportFormats = useMemo(
		() => requestedOutputFormats.filter(isExportFormat),
		[requestedOutputFormats],
	);
	const publishToKnowledgeBase = intent === "documentation" && autoPublishToKnowledgeBase;
	const effectiveTargetDocumentationId = publishToKnowledgeBase ? targetDocumentationId.trim() : "";
	const visibleExportFormats = useMemo(() => {
		const formats = [...requestedExportFormats];
		for (const format of EXPORT_FORMATS) {
			if (exportArtifacts[format] && !formats.includes(format)) {
				formats.push(format);
			}
		}
		return formats;
	}, [exportArtifacts, requestedExportFormats]);
	const pptxOptions = useMemo<DocsiePptxOptions>(
		() => ({
			deckType: pptxDeckType.trim() || undefined,
			sourceName: pptxSourceName.trim() || undefined,
			enhance: pptxEnhance.trim() || undefined,
			audience: pptxAudience.trim() || undefined,
			maxSlides: normalizePptxMaxSlides(pptxMaxSlides),
			generateCoverImage: pptxGenerateCoverImage,
			imageQuality: pptxImageQuality,
			illustrationStyle: pptxIllustrationStyle.trim() || undefined,
			embedImages: pptxEmbedImages,
		}),
		[
			pptxAudience,
			pptxDeckType,
			pptxEmbedImages,
			pptxEnhance,
			pptxGenerateCoverImage,
			pptxIllustrationStyle,
			pptxImageQuality,
			pptxMaxSlides,
			pptxSourceName,
		],
	);
	const displayedWorkspaceName = selectedWorkspace?.name ?? storedWorkspaceName;
	const hasConnectionCredentials = hasStoredToken || Boolean(tokenInput.trim());
	const estimateText = getEstimateText(estimate);
	const creditBalanceText = getCreditBalanceText(creditBalance);
	const creditBalanceDetail = getCreditBalanceDetail(creditBalance);
	const estimateFrames = estimateFrameCount(videoDurationSeconds, estimate?.secondsPerFrame);
	const samplingText = formatSecondsPerFrame(estimate?.secondsPerFrame);
	const markdownReady = Boolean(jobResult?.markdown);
	const canManuallyGenerate =
		phase === "completed" && !autoGenerate && Boolean(analysisJobId) && !generationJobId;
	const isWorking =
		savingConfig ||
		loadingWorkspaces ||
		loadingEstimate ||
		phase === "starting" ||
		phase === "analysis" ||
		phase === "generation";

	const loadGenerationTemplates = useCallback(async () => {
		setLoadingTemplates(true);
		try {
			const result = await window.electronAPI.docsieListGenerationTemplates();
			if (result.success) {
				setGenerationTemplates(result.templates);
			}
		} finally {
			setLoadingTemplates(false);
		}
	}, []);

	const loadCreditBalance = useCallback(async () => {
		setLoadingCreditBalance(true);
		try {
			const result = await window.electronAPI.docsieGetCreditBalance();
			if (result.success) {
				setCreditBalance(result.balance ?? null);
			}
			return result;
		} finally {
			setLoadingCreditBalance(false);
		}
	}, []);

	const loadDocumentationShelves = useCallback(async (nextWorkspaceId?: string) => {
		const resolvedWorkspaceId = nextWorkspaceId?.trim();
		if (!resolvedWorkspaceId) {
			setDocumentationShelves([]);
			return;
		}

		setLoadingShelves(true);
		try {
			const result = await window.electronAPI.docsieListDocumentationShelves({
				workspaceId: resolvedWorkspaceId,
			});
			if (result.success) {
				setDocumentationShelves(result.shelves);
			} else {
				setDocumentationShelves([]);
			}
			return result;
		} finally {
			setLoadingShelves(false);
		}
	}, []);

	const loadState = useCallback(async () => {
		const result = await window.electronAPI.docsieGetState();
		if (!result.success || !result.state) {
			return;
		}

		const state: DocsieIntegrationState = result.state;
		setApiBaseUrl(state.apiBaseUrl);
		setWebAppUrl(getDocsieWebAppUrl(state.apiBaseUrl));
		setAuthMode(state.authMode);
		setHasStoredToken(state.hasToken);
		setOrganizationName(state.organizationName ?? "");
		setWorkspaceId(state.workspaceId ?? "");
		setStoredWorkspaceName(state.workspaceName ?? "");
		setQuality(state.defaultQuality);
		setLanguage(state.defaultLanguage);
		setDocStyle(state.defaultDocStyle);
		setRewriteInstructions(state.defaultRewriteInstructions ?? "");
		setGenerationTemplateId(state.defaultGenerationTemplateId ?? "");
		setTemplateInstruction(state.defaultTemplateInstruction ?? "");
		setIntent(state.defaultIntent ?? "documentation");
		setAutoPublishToKnowledgeBase(state.autoPublishToKnowledgeBase);
		setTargetDocumentationId(state.targetDocumentationId ?? "");
		setAutoGenerate(state.autoGenerate);
		setArtifactMode(getArtifactModeFromOutputFormats(state.defaultOutputFormats));
		setPptxDeckType(state.defaultPptxOptions.deckType ?? "training");
		setPptxSourceName(state.defaultPptxOptions.sourceName ?? "Screen Recorder");
		setPptxEnhance(state.defaultPptxOptions.enhance ?? "required");
		setPptxAudience(state.defaultPptxOptions.audience ?? "");
		setPptxMaxSlides(String(normalizePptxMaxSlides(state.defaultPptxOptions.maxSlides)));
		setPptxGenerateCoverImage(state.defaultPptxOptions.generateCoverImage ?? true);
		setPptxImageQuality(state.defaultPptxOptions.imageQuality ?? "medium");
		setPptxIllustrationStyle(state.defaultPptxOptions.illustrationStyle ?? "corporate");
		setPptxEmbedImages(state.defaultPptxOptions.embedImages ?? true);

		if (state.hasToken) {
			let nextWorkspaceId = state.workspaceId ?? "";
			const workspacesResult = await window.electronAPI.docsieListWorkspaces();
			if (workspacesResult.success) {
				setWorkspaces(workspacesResult.workspaces);
				if (!state.workspaceId && workspacesResult.workspaces.length > 0) {
					const firstWorkspace = workspacesResult.workspaces[0];
					setWorkspaceId(firstWorkspace.id);
					setStoredWorkspaceName(firstWorkspace.name);
					nextWorkspaceId = firstWorkspace.id;
				}
			}
			void loadDocumentationShelves(nextWorkspaceId);
			void loadGenerationTemplates();
			void loadCreditBalance();
		}
	}, [loadCreditBalance, loadDocumentationShelves, loadGenerationTemplates]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		void loadState();
		setBookTitle(buildDefaultBookTitle(videoPath));
	}, [isOpen, loadState, videoPath]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleDesktopAuthEvent = (event: Event) => {
			const customEvent = event as CustomEvent<{ status?: string }>;
			if (customEvent.detail?.status !== "success") {
				return;
			}

			void loadState();
		};

		window.addEventListener("docsie-desktop-auth-event", handleDesktopAuthEvent as EventListener);
		return () => {
			window.removeEventListener(
				"docsie-desktop-auth-event",
				handleDesktopAuthEvent as EventListener,
			);
		};
	}, [isOpen, loadState]);

	useEffect(() => {
		if (
			!isOpen ||
			!hasStoredToken ||
			typeof videoDurationSeconds !== "number" ||
			videoDurationSeconds <= 0
		) {
			return;
		}

		let cancelled = false;

		const estimateVideo = async () => {
			setLoadingEstimate(true);
			try {
				const result = await window.electronAPI.docsieEstimateVideoToDocs({
					quality,
					workspaceId,
					durationSeconds: videoDurationSeconds,
				});
				if (!cancelled) {
					setEstimate(result);
				}
			} finally {
				if (!cancelled) {
					setLoadingEstimate(false);
				}
			}
		};

		void estimateVideo();
		return () => {
			cancelled = true;
		};
	}, [hasStoredToken, isOpen, quality, videoDurationSeconds, workspaceId]);

	useEffect(() => {
		if (!isOpen || !videoPath) {
			setHistoryEntries([]);
			return;
		}

		let cancelled = false;

		const loadHistory = async () => {
			const result = await window.electronAPI.docsieListVideoToDocsHistory(videoPath);
			if (!cancelled && result.success) {
				setHistoryEntries(dedupeHistoryEntries(result.entries));
			}
		};

		void loadHistory();
		return () => {
			cancelled = true;
		};
	}, [isOpen, videoPath]);

	useEffect(() => {
		if (!isOpen || !hasStoredToken || phase !== "completed") {
			return;
		}

		void (async () => {
			await loadCreditBalance();
			await onCreditsChanged?.();
		})();
	}, [hasStoredToken, isOpen, loadCreditBalance, onCreditsChanged, phase]);

	const persistConfig = useCallback(async () => {
		setSavingConfig(true);
		try {
			const result = await window.electronAPI.docsieSaveConfig({
				apiBaseUrl: buildApiBaseUrl(webAppUrl, apiBaseUrl),
				authMode,
				token: tokenInput,
				organizationName,
				workspaceId,
				workspaceName: selectedWorkspace?.name ?? storedWorkspaceName,
				defaultQuality: quality,
				defaultLanguage: language,
				defaultDocStyle: docStyle,
				defaultRewriteInstructions: rewriteInstructions,
				defaultGenerationTemplateId: generationTemplateId || undefined,
				defaultTemplateInstruction: templateInstruction,
				defaultIntent: intent,
				targetDocumentationId: effectiveTargetDocumentationId || undefined,
				autoPublishToKnowledgeBase,
				autoGenerate,
				defaultOutputFormats: requestedOutputFormats,
				defaultPptxOptions: pptxOptions,
			});

			if (!result.success || !result.state) {
				throw new Error(result.error ?? "Failed to save Docsie settings");
			}

			setApiBaseUrl(result.state.apiBaseUrl);
			setWebAppUrl(getDocsieWebAppUrl(result.state.apiBaseUrl));
			setHasStoredToken(result.state.hasToken);
			setOrganizationName(result.state.organizationName ?? organizationName);
			setStoredWorkspaceName(
				result.state.workspaceName ?? selectedWorkspace?.name ?? storedWorkspaceName,
			);
			setTokenInput("");
			return result.state;
		} finally {
			setSavingConfig(false);
		}
	}, [
		apiBaseUrl,
		authMode,
		autoPublishToKnowledgeBase,
		autoGenerate,
		docStyle,
		effectiveTargetDocumentationId,
		generationTemplateId,
		intent,
		language,
		organizationName,
		pptxOptions,
		quality,
		requestedOutputFormats,
		rewriteInstructions,
		selectedWorkspace?.name,
		storedWorkspaceName,
		targetDocumentationId,
		templateInstruction,
		tokenInput,
		webAppUrl,
		workspaceId,
	]);

	const handleConnect = useCallback(async () => {
		const launchUrl = buildDocsieDesktopConnectUrl(
			buildDesktopAuthWebAppUrl(webAppUrl, apiBaseUrl),
			{
				workspaceId,
				docStyle,
				quality,
				language,
				generationTemplateId,
				templateInstruction,
				rewriteInstructions,
				intent,
				targetDocumentationId: effectiveTargetDocumentationId,
				autoPublishToKnowledgeBase: publishToKnowledgeBase,
				autoGenerate,
				outputFormats: requestedOutputFormats,
				pptxOptions: artifactMode === "presentation" ? pptxOptions : undefined,
			},
		);

		const result = await window.electronAPI.openExternalUrl(launchUrl);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie sign-in");
			return;
		}

		toast.success("Opened Docsie sign-in in your browser");
	}, [
		apiBaseUrl,
		artifactMode,
		autoGenerate,
		docStyle,
		effectiveTargetDocumentationId,
		generationTemplateId,
		intent,
		language,
		pptxOptions,
		publishToKnowledgeBase,
		quality,
		requestedOutputFormats,
		rewriteInstructions,
		templateInstruction,
		webAppUrl,
		workspaceId,
	]);

	const handleCreateAccount = useCallback(async () => {
		const launchUrl = buildDocsieDesktopSignupUrl(
			buildDesktopAuthWebAppUrl(webAppUrl, apiBaseUrl),
			{
				workspaceId,
				docStyle,
				quality,
				language,
				generationTemplateId,
				templateInstruction,
				rewriteInstructions,
				intent,
				targetDocumentationId: effectiveTargetDocumentationId,
				autoPublishToKnowledgeBase: publishToKnowledgeBase,
				autoGenerate,
				outputFormats: requestedOutputFormats,
				pptxOptions: artifactMode === "presentation" ? pptxOptions : undefined,
			},
		);

		const result = await window.electronAPI.openExternalUrl(launchUrl);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie sign-up");
			return;
		}

		toast.success("Opened Docsie sign-up in your browser");
	}, [
		apiBaseUrl,
		artifactMode,
		autoGenerate,
		docStyle,
		effectiveTargetDocumentationId,
		generationTemplateId,
		intent,
		language,
		pptxOptions,
		publishToKnowledgeBase,
		quality,
		requestedOutputFormats,
		rewriteInstructions,
		templateInstruction,
		webAppUrl,
		workspaceId,
	]);

	const handleRefreshWorkspaces = useCallback(async () => {
		if (!hasConnectionCredentials) {
			toast.error("Connect this recorder to Docsie first");
			return;
		}

		setLoadingWorkspaces(true);
		try {
			await persistConfig();
			const result = await window.electronAPI.docsieListWorkspaces();
			if (!result.success) {
				throw new Error(result.error ?? "Failed to load Docsie workspaces");
			}

			setWorkspaces(result.workspaces);
			let nextWorkspaceId = workspaceId;
			if (!workspaceId && result.workspaces.length > 0) {
				const firstWorkspace = result.workspaces[0];
				setWorkspaceId(firstWorkspace.id);
				setStoredWorkspaceName(firstWorkspace.name);
				nextWorkspaceId = firstWorkspace.id;
			}
			void loadDocumentationShelves(nextWorkspaceId);
			void loadGenerationTemplates();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setLoadingWorkspaces(false);
		}
	}, [
		hasConnectionCredentials,
		loadDocumentationShelves,
		loadGenerationTemplates,
		persistConfig,
		workspaceId,
	]);

	const runGeneration = useCallback(
		async (sourceJobId: string) => {
			setBusyMessage(
				artifactMode === "presentation"
					? "Docsie is generating markdown and a PowerPoint deck."
					: "Docsie is generating markdown, PDF, and DOCX output.",
			);

			const result = await window.electronAPI.docsieGenerateVideoToDocs({
				jobId: sourceJobId,
				docStyle: getDocStyleForArtifactMode(artifactMode, docStyle, pptxDeckType),
				rewriteInstructions,
				generationTemplateId:
					artifactMode === "docs" ? generationTemplateId || undefined : undefined,
				templateInstruction: artifactMode === "docs" ? templateInstruction : undefined,
				targetLanguage: language,
				intent,
				targetDocumentationId: effectiveTargetDocumentationId || undefined,
				autoPublishToKnowledgeBase: publishToKnowledgeBase,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				outputFormats: requestedOutputFormats,
				pptxOptions: artifactMode === "presentation" ? pptxOptions : undefined,
			});

			if (!result.success || !result.generateJobId) {
				throw new Error(result.error ?? "Failed to start Docsie generation");
			}

			setGenerationJobId(result.generateJobId);
			setActiveJobId(result.generateJobId);
			setPhase("generation");
			setBusyMessage(
				artifactMode === "presentation"
					? "Docsie is building the presentation and export file."
					: "Docsie is building the finished documentation and export files.",
			);
			toast.success("Docsie generation started");
		},
		[
			artifactMode,
			bookTitle,
			docStyle,
			effectiveTargetDocumentationId,
			generationTemplateId,
			intent,
			language,
			pptxDeckType,
			pptxOptions,
			publishToKnowledgeBase,
			requestedOutputFormats,
			rewriteInstructions,
			templateInstruction,
			videoPath,
		],
	);

	useEffect(() => {
		if (!isOpen || !activeJobId || phase === "completed" || phase === "failed") {
			return;
		}

		let cancelled = false;

		const poll = async () => {
			const status = await window.electronAPI.docsieGetJobStatus(activeJobId);
			if (cancelled) {
				return;
			}

			setJobStatus(status);
			if (!status.success) {
				setPhase("failed");
				setBusyMessage(status.error ?? "Failed to poll Docsie job status");
				return;
			}

			const normalizedStatus = (status.normalizedStatus ?? status.status ?? "").toLowerCase();
			if (
				normalizedStatus !== "done" &&
				normalizedStatus !== "failed" &&
				normalizedStatus !== "canceled"
			) {
				return;
			}

			const result = await window.electronAPI.docsieGetJobResult(activeJobId);
			if (cancelled) {
				return;
			}

			setJobResult(result);

			if (!result.success || normalizedStatus === "failed" || normalizedStatus === "canceled") {
				setPhase("failed");
				setBusyMessage(result.error ?? status.error ?? "Docsie job failed");
				return;
			}

			if (phase === "analysis" && autoGenerate) {
				try {
					await runGeneration(result.jobId ?? activeJobId);
				} catch (error) {
					setPhase("failed");
					setBusyMessage(error instanceof Error ? error.message : String(error));
					toast.error(error instanceof Error ? error.message : "Failed to generate docs");
				}
				return;
			}

			setPhase("completed");
			setBusyMessage(
				phase === "analysis"
					? "Docsie finished the analysis. You can generate the final docs when ready."
					: artifactMode === "presentation"
						? "Docsie finished converting this recording into a presentation."
						: "Docsie finished converting this recording into documentation.",
			);
		};

		void poll();
		const intervalId = window.setInterval(() => {
			void poll();
		}, 5000);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [activeJobId, artifactMode, autoGenerate, isOpen, phase, runGeneration]);

	useEffect(() => {
		const baseArtifacts = normalizeExportArtifacts(jobResult?.exports);
		setExportArtifacts(baseArtifacts);

		if (!jobResult?.exports || !Object.values(baseArtifacts).some((artifact) => artifact?.jobId)) {
			return;
		}

		let cancelled = false;
		let timeoutId: number | null = null;
		let currentArtifacts: Partial<Record<ExportFormat, ExportArtifact>> = {
			...baseArtifacts,
		};

		const pollExports = async () => {
			const updatedArtifacts: Partial<Record<ExportFormat, ExportArtifact>> = {
				...currentArtifacts,
			};
			let needsAnotherPoll = false;

			for (const format of EXPORT_FORMATS) {
				const artifact = updatedArtifacts[format];
				if (!artifact?.jobId || artifact.status === "ready" || artifact.status === "failed") {
					continue;
				}

				const exportJob = await window.electronAPI.docsieGetBackgroundJob(artifact.jobId);
				if (cancelled) {
					return;
				}

				if (!exportJob.success) {
					needsAnotherPoll = true;
					continue;
				}

				const normalizedStatus = (exportJob.status ?? "").toLowerCase();
				const payload = exportJob.result;
				const url = payload && isRecord(payload) ? (asString(payload.url) ?? undefined) : undefined;
				const filename =
					payload && isRecord(payload) ? (asString(payload.filename) ?? undefined) : undefined;
				const error =
					payload && isRecord(payload) ? (asString(payload.error) ?? undefined) : undefined;

				if (normalizedStatus === "done" && url) {
					updatedArtifacts[format] = {
						...artifact,
						status: "ready",
						url,
						filename,
						error: undefined,
					};
					continue;
				}

				if (normalizedStatus === "failed" || normalizedStatus === "canceled") {
					updatedArtifacts[format] = {
						...artifact,
						status: "failed",
						error: error ?? `Export ${normalizedStatus}`,
					};
					continue;
				}

				updatedArtifacts[format] = {
					...artifact,
					status: "processing",
					url,
					filename,
				};
				needsAnotherPoll = true;
			}

			setExportArtifacts(updatedArtifacts);
			currentArtifacts = updatedArtifacts;
			if (needsAnotherPoll && !cancelled) {
				timeoutId = window.setTimeout(() => {
					void pollExports();
				}, 5000);
			}
		};

		void pollExports();
		return () => {
			cancelled = true;
			if (timeoutId) {
				window.clearTimeout(timeoutId);
			}
		};
	}, [jobResult?.exports]);

	useEffect(() => {
		if (!videoPath || phase !== "completed" || !jobResult?.success || !jobResult.jobId) {
			return;
		}

		const resultHistoryKey = getResultHistoryKey(jobResult);
		if (!resultHistoryKey || savedHistoryKeysRef.current.has(resultHistoryKey)) {
			return;
		}

		if (historyEntries.some((entry) => getHistoryEntryKey(entry) === resultHistoryKey)) {
			return;
		}

		savedHistoryKeysRef.current.add(resultHistoryKey);

		void window.electronAPI
			.docsieSaveVideoToDocsHistory({
				videoPath,
				videoName: videoPath.split("/").pop() ?? "Video Documentation",
				quality,
				language,
				docStyle,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				intent,
				targetDocumentationId: effectiveTargetDocumentationId || undefined,
				autoPublishToKnowledgeBase: publishToKnowledgeBase,
				generationTemplateId:
					artifactMode === "docs" ? generationTemplateId || undefined : undefined,
				generationTemplateName:
					artifactMode === "docs" ? selectedGenerationTemplate?.name : undefined,
				templateInstruction: artifactMode === "docs" ? templateInstruction : undefined,
				rewriteInstructions,
				outputFormats: requestedOutputFormats,
				pptxOptions: artifactMode === "presentation" ? pptxOptions : undefined,
				analysisJobId: analysisJobId ?? undefined,
				generationJobId: generationJobId ?? undefined,
				jobResult,
			})
			.then((result) => {
				if (!result.success || !result.entry) {
					savedHistoryKeysRef.current.delete(resultHistoryKey);
					return;
				}

				const savedEntry = result.entry;
				setHistoryEntries((current) => {
					const next = dedupeHistoryEntries([
						savedEntry,
						...current.filter(
							(entry) => getHistoryEntryKey(entry) !== getHistoryEntryKey(savedEntry),
						),
					]);
					return next.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				});
			})
			.catch(() => {
				savedHistoryKeysRef.current.delete(resultHistoryKey);
			});
	}, [
		analysisJobId,
		artifactMode,
		bookTitle,
		docStyle,
		effectiveTargetDocumentationId,
		generationTemplateId,
		generationJobId,
		historyEntries,
		intent,
		jobResult,
		language,
		phase,
		pptxOptions,
		quality,
		requestedOutputFormats,
		rewriteInstructions,
		selectedGenerationTemplate?.name,
		publishToKnowledgeBase,
		templateInstruction,
		videoPath,
	]);

	useEffect(() => {
		const generatedShelfId = jobResult?.documentationId?.trim();
		if (
			!isOpen ||
			!hasStoredToken ||
			phase !== "completed" ||
			!jobResult?.success ||
			!publishToKnowledgeBase ||
			!generatedShelfId ||
			targetDocumentationId.trim()
		) {
			return;
		}

		setTargetDocumentationId(generatedShelfId);
		setDocumentationShelves((current) => {
			if (current.some((shelf) => shelf.id === generatedShelfId)) {
				return current;
			}
			return [
				{
					id: generatedShelfId,
					name: jobResult.documentationName ?? jobResult.bookName ?? "Generated shelf",
					workspaceId: jobResult.workspaceId ?? workspaceId,
				},
				...current,
			];
		});

		void window.electronAPI.docsieSaveConfig({
			apiBaseUrl: buildApiBaseUrl(webAppUrl, apiBaseUrl),
			authMode,
			organizationName,
			workspaceId,
			workspaceName: selectedWorkspace?.name ?? storedWorkspaceName,
			defaultQuality: quality,
			defaultLanguage: language,
			defaultDocStyle: docStyle,
			defaultRewriteInstructions: rewriteInstructions,
			defaultGenerationTemplateId: generationTemplateId || undefined,
			defaultTemplateInstruction: templateInstruction,
			defaultIntent: intent,
			targetDocumentationId: generatedShelfId,
			autoPublishToKnowledgeBase,
			autoGenerate,
			defaultOutputFormats: requestedOutputFormats,
			defaultPptxOptions: pptxOptions,
		});
	}, [
		apiBaseUrl,
		authMode,
		autoPublishToKnowledgeBase,
		autoGenerate,
		docStyle,
		generationTemplateId,
		hasStoredToken,
		intent,
		isOpen,
		jobResult,
		language,
		organizationName,
		phase,
		pptxOptions,
		publishToKnowledgeBase,
		quality,
		requestedOutputFormats,
		rewriteInstructions,
		selectedWorkspace?.name,
		storedWorkspaceName,
		targetDocumentationId,
		templateInstruction,
		webAppUrl,
		workspaceId,
	]);

	const handleStart = useCallback(async () => {
		if (!videoPath) {
			toast.error("No video available to send to Docsie");
			return;
		}
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie before converting this recording");
			return;
		}

		setBusyMessage("Uploading the current recording to Docsie.");
		setJobStatus(null);
		setJobResult(null);
		setExportArtifacts({});
		setAnalysisJobId(null);
		setGenerationJobId(null);
		setActiveJobId(null);
		setPhase("starting");

		try {
			await persistConfig();
			const result = await window.electronAPI.docsieStartVideoToDocs({
				videoPath,
				quality,
				language,
				workspaceId,
				docStyle: getDocStyleForArtifactMode(artifactMode, docStyle, pptxDeckType),
				rewriteInstructions,
				generationTemplateId:
					artifactMode === "docs" ? generationTemplateId || undefined : undefined,
				templateInstruction: artifactMode === "docs" ? templateInstruction : undefined,
				intent,
				targetDocumentationId: effectiveTargetDocumentationId || undefined,
				autoPublishToKnowledgeBase: publishToKnowledgeBase,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				autoGenerate: false,
				outputFormats: requestedOutputFormats,
				pptxOptions: artifactMode === "presentation" ? pptxOptions : undefined,
			});

			if (!result.success || !result.jobId) {
				throw new Error(result.error ?? "Failed to start Docsie job");
			}

			setAnalysisJobId(result.jobId);
			setActiveJobId(result.jobId);
			setPhase("analysis");
			setBusyMessage(
				autoGenerate
					? artifactMode === "presentation"
						? "Docsie accepted the recording. Analysis is running before presentation generation."
						: "Docsie accepted the recording. Analysis is running before docs generation."
					: "Docsie accepted the recording. Analysis is running.",
			);
			toast.success("Recording sent to Docsie");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setPhase("failed");
			setBusyMessage(message);
			toast.error(message);
		}
	}, [
		artifactMode,
		autoGenerate,
		bookTitle,
		docStyle,
		effectiveTargetDocumentationId,
		generationTemplateId,
		hasConnectionCredentials,
		intent,
		language,
		persistConfig,
		pptxDeckType,
		pptxOptions,
		quality,
		publishToKnowledgeBase,
		requestedOutputFormats,
		rewriteInstructions,
		templateInstruction,
		videoPath,
		workspaceId,
	]);

	const handleGenerate = useCallback(async () => {
		if (!analysisJobId) {
			toast.error("Run the analysis step first");
			return;
		}
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie before generating documentation");
			return;
		}

		try {
			await persistConfig();
			await runGeneration(analysisJobId);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setPhase("failed");
			setBusyMessage(message);
			toast.error(message);
		}
	}, [analysisJobId, hasConnectionCredentials, persistConfig, runGeneration]);

	const handleOpenResult = useCallback(async () => {
		const url = getPrimaryResultUrl(jobResult);
		if (!url) {
			return;
		}

		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie result");
		}
	}, [jobResult]);

	const handleOpenHistoryEntry = useCallback((entry: DocsieVideoToDocsHistoryEntry) => {
		setJobStatus(null);
		setJobResult(entry.jobResult);
		setExportArtifacts(normalizeExportArtifacts(entry.jobResult.exports));
		setArtifactMode(
			getArtifactModeFromOutputFormats(
				entry.outputFormats ??
					(entry.jobResult.exports && "pptx" in entry.jobResult.exports
						? PRESENTATION_OUTPUT_FORMATS
						: DOCS_OUTPUT_FORMATS),
			),
		);
		if (entry.pptxOptions) {
			setPptxDeckType(entry.pptxOptions.deckType ?? "training");
			setPptxSourceName(entry.pptxOptions.sourceName ?? "Screen Recorder");
			setPptxEnhance(entry.pptxOptions.enhance ?? "required");
			setPptxAudience(entry.pptxOptions.audience ?? "");
			setPptxMaxSlides(String(normalizePptxMaxSlides(entry.pptxOptions.maxSlides)));
			setPptxGenerateCoverImage(entry.pptxOptions.generateCoverImage ?? true);
			setPptxImageQuality(entry.pptxOptions.imageQuality ?? "medium");
			setPptxIllustrationStyle(entry.pptxOptions.illustrationStyle ?? "corporate");
			setPptxEmbedImages(entry.pptxOptions.embedImages ?? true);
		}
		setAnalysisJobId(entry.analysisJobId ?? null);
		setGenerationJobId(entry.generationJobId ?? entry.jobResult.jobId ?? null);
		setActiveJobId(null);
		setBusyMessage("Loaded this completed Docsie result from local history.");
		setPhase("completed");
		const restoredIntent =
			entry.intent ??
			(entry.targetDocumentationId || entry.jobResult.documentationId ? "documentation" : "export");
		const restoredAutoPublish =
			entry.autoPublishToKnowledgeBase ??
			Boolean(entry.targetDocumentationId || entry.jobResult.documentationId);
		setIntent(restoredIntent);
		setAutoPublishToKnowledgeBase(restoredAutoPublish);
		setTargetDocumentationId(
			restoredIntent === "documentation" && restoredAutoPublish
				? (entry.targetDocumentationId ?? entry.jobResult.documentationId ?? "")
				: "",
		);
	}, []);

	const handleOpenExport = useCallback(async (artifact: ExportArtifact) => {
		if (!artifact.url) {
			return;
		}

		const result = await window.electronAPI.openExternalUrl(artifact.url);
		if (!result.success) {
			toast.error(result.error ?? `Failed to open ${getExportLabel(artifact.format)} export`);
		}
	}, []);

	const handleDownloadMarkdown = useCallback(() => {
		if (!jobResult?.markdown) {
			return;
		}

		void window.electronAPI
			.saveTextFile(jobResult.markdown, normalizeMarkdownFileName(getResultTitle(jobResult)), [
				{ name: "Markdown", extensions: ["md", "markdown"] },
			])
			.then((result) => {
				if (!result.success) {
					if (!result.canceled) {
						toast.error(result.message ?? "Failed to save markdown");
					}
					return;
				}

				toast.success("Markdown saved");
			});
	}, [jobResult]);

	const handleCopyMarkdown = useCallback(async () => {
		if (!jobResult?.markdown) {
			return;
		}

		try {
			await navigator.clipboard.writeText(jobResult.markdown);
			toast.success("Markdown copied");
		} catch {
			toast.error("Failed to copy markdown");
		}
	}, [jobResult]);

	const connectionSummary = hasStoredToken
		? organizationName
			? `Connected to ${organizationName}`
			: "Connected to Docsie"
		: "Docsie login required";
	const showAnalysisScreen = phase !== "idle" || Boolean(jobResult) || Boolean(activeJobId);
	const showAdvancedOutputs = isWorking || phase === "completed";
	const recordingSummary = videoPath ? videoPath.split("/").pop() : "No loaded recording";
	const artifactLabel = artifactMode === "presentation" ? "Presentation" : "Docs";
	const artifactActionLabel =
		artifactMode === "presentation" ? "Create Presentation" : "Convert Video To Docs";
	const docsiePersistenceLabel = getDocsiePersistenceLabel(jobResult);
	const statusMessage = formatStatusMessage(
		busyMessage ?? "Docsie is preparing the current recording.",
	);
	const qualitySummary = [
		samplingText,
		estimateFrames ? `~${estimateFrames} frames` : null,
		estimateText,
	]
		.filter(Boolean)
		.join(" • ");
	const primaryActionLabel = !hasStoredToken
		? "Log In To Docsie"
		: phase === "completed" && getPrimaryResultUrl(jobResult)
			? "Open In Docsie"
			: phase === "failed"
				? "Run Analysis Again"
				: artifactActionLabel;
	const compactSummary = [
		hasStoredToken
			? displayedWorkspaceName || organizationName || "Docsie connected"
			: "Sign in required",
		artifactLabel,
		recordingSummary,
		typeof videoDurationSeconds === "number" && videoDurationSeconds > 0
			? formatDuration(videoDurationSeconds)
			: null,
		estimateText,
		creditBalanceText,
	]
		.filter(Boolean)
		.join(" • ");

	const handlePrimaryAction = useCallback(async () => {
		if (!hasStoredToken) {
			await handleConnect();
			return;
		}
		if (phase === "completed" && getPrimaryResultUrl(jobResult)) {
			await handleOpenResult();
			return;
		}
		if (isWorking) {
			return;
		}
		await handleStart();
	}, [handleConnect, handleOpenResult, handleStart, hasStoredToken, isWorking, jobResult, phase]);

	const artifactModeSelector = (
		<div className="grid gap-2 sm:grid-cols-2">
			{[
				{
					mode: "docs" as const,
					label: "Docs",
					description: "Markdown, DOCX, and PDF",
					icon: FileText,
				},
				{
					mode: "presentation" as const,
					label: "Presentation",
					description: "Markdown and PowerPoint",
					icon: Presentation,
				},
			].map((option) => {
				const Icon = option.icon;
				const selected = artifactMode === option.mode;
				return (
					<button
						key={option.mode}
						type="button"
						onClick={() => setArtifactMode(option.mode)}
						disabled={isWorking}
						className={cn(
							"flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors",
							selected
								? "border-[#FF6738] bg-[rgba(255,103,56,0.14)] text-[#fff0e4]"
								: "border-white/10 bg-[#17110f] text-[#c6b4a8] hover:bg-white/5",
						)}
					>
						<span
							className={cn(
								"flex h-10 w-10 shrink-0 items-center justify-center rounded-full border",
								selected
									? "border-[rgba(255,103,56,0.34)] bg-[rgba(255,103,56,0.18)] text-[#FEA85E]"
									: "border-white/10 bg-white/5 text-[#8f7e73]",
							)}
						>
							<Icon className="h-5 w-5" />
						</span>
						<span className="min-w-0">
							<span className="block text-sm font-semibold">{option.label}</span>
							<span className="mt-0.5 block text-xs text-[#8f7e73]">{option.description}</span>
						</span>
					</button>
				);
			})}
		</div>
	);

	const statusPanel = (
		<div className="rounded-3xl border border-[rgba(254,168,94,0.16)] bg-[radial-gradient(circle_at_top,rgba(255,103,56,0.18),transparent_42%),linear-gradient(135deg,#241917_0%,#17110f_100%)] p-6">
			<div className="flex items-center gap-3">
				<div
					className={cn(
						"rounded-full border p-2.5",
						phase === "completed"
							? "border-[rgba(75,181,67,0.28)] bg-[rgba(75,181,67,0.12)] text-[#8ce18b]"
							: phase === "failed"
								? "border-[rgba(255,103,56,0.28)] bg-[rgba(255,103,56,0.12)] text-[#ffb8a1]"
								: "border-[rgba(254,168,94,0.18)] bg-[rgba(254,168,94,0.08)] text-[#FEA85E]",
					)}
				>
					{phase === "completed" ? (
						<CheckCircle2 className="h-5 w-5" />
					) : isWorking ? (
						<Loader2 className="h-5 w-5 animate-spin" />
					) : phase === "failed" ? (
						<ShieldCheck className="h-5 w-5" />
					) : (
						<Sparkles className="h-5 w-5" />
					)}
				</div>
				<div>
					<div className="text-lg font-semibold text-[#fff0e4]">
						{phase === "generation" && artifactMode === "presentation"
							? "Building presentation"
							: formatJobPhase(phase)}
					</div>
					<div className="max-h-28 overflow-y-auto break-words text-sm text-[#c6b4a8]">
						{statusMessage}
					</div>
				</div>
			</div>

			<div className="mt-4 text-sm text-[#c6b4a8]">
				{recordingSummary}
				{typeof videoDurationSeconds === "number" && videoDurationSeconds > 0
					? ` • ${formatDuration(videoDurationSeconds)}`
					: ""}
				{estimateText ? ` • ${estimateText}` : ""}
			</div>
			{jobStatus?.status ? (
				<div className="mt-2 text-xs uppercase tracking-[0.16em] text-[#8f7e73]">
					Status: {jobStatus.status}
				</div>
			) : null}

			<div className="mt-5 grid gap-2 sm:grid-cols-3">
				{[
					{
						label: "Analyze",
						active:
							phase === "starting" ||
							phase === "analysis" ||
							phase === "generation" ||
							phase === "completed",
						done: phase === "analysis" || phase === "generation" || phase === "completed",
					},
					{
						label: artifactMode === "presentation" ? "Build Deck" : "Generate",
						active: phase === "generation" || phase === "completed",
						done: phase === "completed" || Boolean(generationJobId),
					},
					{
						label: "Exports",
						active: phase === "completed",
						done: Object.values(exportArtifacts).some((artifact) => artifact?.status === "ready"),
					},
				].map((step) => (
					<div
						key={step.label}
						className={cn(
							"min-w-0 rounded-full border px-3 py-2 text-center text-xs font-medium uppercase tracking-[0.14em]",
							step.done
								? "border-[rgba(75,181,67,0.28)] bg-[rgba(75,181,67,0.1)] text-[#8ce18b]"
								: step.active
									? "border-[rgba(254,168,94,0.22)] bg-[rgba(254,168,94,0.08)] text-[#fff0e4]"
									: "border-white/10 bg-[#17110f] text-[#8f7e73]",
						)}
					>
						{step.label}
					</div>
				))}
			</div>

			{phase === "failed" ? (
				<div className="mt-5 flex flex-wrap gap-2">
					<Button
						type="button"
						onClick={() => void handleStart()}
						disabled={!videoPath || isWorking}
						className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
					>
						<RefreshCcw className="mr-2 h-4 w-4" />
						Run Analysis Again
					</Button>
					<Button
						type="button"
						variant="secondary"
						onClick={() => setShowSettingsDialog(true)}
						className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
					>
						Additional settings
					</Button>
				</div>
			) : null}
		</div>
	);

	const filesPanel = showAdvancedOutputs ? (
		<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
			<div className="mb-3 flex items-start justify-between gap-3">
				<div>
					<div className="text-sm font-semibold text-[#fff0e4]">Files</div>
					<div className="text-xs text-[#8f7e73]">
						Open the Docsie result or download the generated files.
					</div>
				</div>
				<div className="flex flex-wrap gap-2">
					{phase === "completed" && getPrimaryResultUrl(jobResult) ? (
						<Button
							type="button"
							onClick={() => void handleOpenResult()}
							className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
						>
							<ExternalLink className="mr-2 h-4 w-4" />
							Open In Docsie
						</Button>
					) : null}
					{phase !== "completed" ? (
						<Button
							type="button"
							variant="secondary"
							onClick={() => setShowSettingsDialog(true)}
							className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
						>
							Additional settings
						</Button>
					) : null}
				</div>
			</div>

			<div
				className={cn(
					"grid gap-3",
					visibleExportFormats.length > 1 ? "sm:grid-cols-3" : "sm:grid-cols-2",
				)}
			>
				<div className="rounded-xl border border-white/10 bg-[#17110f] p-3">
					<div className="flex items-start justify-between gap-3">
						<div className="min-w-0">
							<div className="text-sm font-medium text-[#fff0e4]">Markdown</div>
							<div className="text-xs text-[#8f7e73]">{markdownReady ? "Ready" : "Pending"}</div>
						</div>
						{markdownReady ? (
							<div className="flex shrink-0 gap-1">
								<Button
									type="button"
									size="icon"
									variant="secondary"
									onClick={() => void handleCopyMarkdown()}
									title="Copy markdown"
									aria-label="Copy markdown"
									className="h-8 w-8 bg-white/10 text-[#fff0e4] hover:bg-white/15"
								>
									<Copy className="h-4 w-4" />
								</Button>
								<Button
									type="button"
									size="icon"
									variant="secondary"
									onClick={() => void handleDownloadMarkdown()}
									title="Download markdown"
									aria-label="Download markdown"
									className="h-8 w-8 bg-white/10 text-[#fff0e4] hover:bg-white/15"
								>
									<Download className="h-4 w-4" />
								</Button>
							</div>
						) : null}
					</div>
					<div className="mt-3 text-xs leading-5 text-[#8f7e73]">
						{markdownReady
							? "Markdown is ready to copy or save locally."
							: "Markdown will appear here when Docsie finishes generation."}
					</div>
				</div>

				{visibleExportFormats.map((format) => {
					const artifact = exportArtifacts[format];
					return (
						<div key={format} className="rounded-xl border border-white/10 bg-[#17110f] p-3">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0">
									<div className="text-sm font-medium text-[#fff0e4]">{getExportLabel(format)}</div>
									<div className="mt-1 text-xs text-[#8f7e73]">
										{artifact?.status === "ready"
											? "Ready"
											: artifact?.status === "failed"
												? (artifact.error ?? "Failed")
												: artifact?.status === "processing"
													? "Processing"
													: artifact?.status === "queued"
														? "Queued"
														: "Pending"}
									</div>
								</div>
								{artifact?.status === "ready" && artifact.url ? (
									<Button
										type="button"
										size="icon"
										variant="secondary"
										onClick={() => void handleOpenExport(artifact)}
										title={`Download ${getExportLabel(format)}`}
										aria-label={`Download ${getExportLabel(format)}`}
										className="h-8 w-8 shrink-0 bg-white/10 text-[#fff0e4] hover:bg-white/15"
									>
										<Download className="h-4 w-4" />
									</Button>
								) : artifact?.status === "processing" || artifact?.status === "queued" ? (
									<Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#FEA85E]" />
								) : null}
							</div>
						</div>
					);
				})}
			</div>

			{phase === "completed" ? (
				<div className="mt-3 rounded-xl border border-[rgba(254,168,94,0.14)] bg-[rgba(255,255,255,0.03)] p-3">
					<div className="text-sm font-medium text-[#fff0e4]">Saved in Docsie</div>
					<div className="mt-1 text-xs leading-5 text-[#8f7e73]">
						{docsiePersistenceLabel || "This generated result is stored in Docsie."}
						{selectedDocumentationShelf?.name && jobResult?.documentationId
							? ` • Shelf: ${selectedDocumentationShelf.name}`
							: ""}
						{typeof jobResult?.creditsCharged === "number"
							? ` • ${jobResult.creditsCharged.toLocaleString()} credits charged`
							: ""}
					</div>
				</div>
			) : null}
		</div>
	) : null;

	const visibleHistoryEntries = dedupeHistoryEntries(historyEntries).sort((a, b) =>
		b.createdAt.localeCompare(a.createdAt),
	);
	const historyPanel =
		videoPath && (visibleHistoryEntries.length > 0 || phase === "completed") ? (
			<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
				<div className="mb-3 flex items-center justify-between gap-3">
					<div>
						<div className="text-sm font-semibold text-[#fff0e4]">Analysis History</div>
						<div className="text-xs text-[#8f7e73]">
							Completed Docsie runs for this recording are saved locally.
						</div>
					</div>
					<div className="text-xs uppercase tracking-[0.16em] text-[#c6b4a8]">
						{visibleHistoryEntries.length} saved
					</div>
				</div>
				{visibleHistoryEntries.length > 0 ? (
					<div className="space-y-2">
						{visibleHistoryEntries.map((entry) => {
							const entryLabel =
								getDocsiePersistenceLabel(entry.jobResult) || entry.bookTitle || entry.videoName;
							return (
								<div key={entry.id} className="rounded-xl border border-white/10 bg-[#17110f] p-3">
									<div className="flex flex-wrap items-start justify-between gap-3">
										<div className="min-w-0">
											<div className="truncate text-sm font-medium text-[#fff0e4]">
												{entryLabel}
											</div>
											<div className="mt-1 text-xs text-[#8f7e73]">
												{formatHistoryDate(entry.createdAt)}
												{entry.quality ? ` • ${entry.quality}` : ""}
												{entry.generationTemplateName ? ` • ${entry.generationTemplateName}` : ""}
											</div>
										</div>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											onClick={() => handleOpenHistoryEntry(entry)}
											className="shrink-0 bg-white/10 text-[#fff0e4] hover:bg-white/15"
										>
											View
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				) : (
					<div className="rounded-xl border border-dashed border-white/10 bg-[#17110f] p-4 text-sm text-[#8f7e73]">
						This completed result is being saved to local history.
					</div>
				)}
			</div>
		) : null;

	return (
		<>
			<Dialog open={isOpen} onOpenChange={onOpenChange}>
				<DialogContent
					className={cn(
						"flex max-h-[90vh] flex-col overflow-hidden border border-[rgba(254,168,94,0.18)] bg-[#17110f] text-[#fff0e4]",
						showAnalysisScreen ? "sm:max-w-[720px]" : "sm:max-w-[640px]",
					)}
				>
					<DialogHeader className="space-y-1 pr-8">
						<DialogTitle className="text-[#fff0e4]">Video To Docs</DialogTitle>
						<DialogDescription className="text-[#8f7e73]">
							{showAnalysisScreen ? "Analysis" : "Launch"}
						</DialogDescription>
					</DialogHeader>
					<div className="min-h-0 flex-1 overflow-y-auto pr-1">
						{showAnalysisScreen ? (
							<div className="space-y-4">
								{phase === "completed" ? (
									<>
										{filesPanel}
										{statusPanel}
										{historyPanel}
									</>
								) : (
									<>
										{statusPanel}
										{filesPanel}
										{historyPanel}
									</>
								)}
							</div>
						) : (
							<div className="space-y-4">
								<div className="rounded-3xl border border-[rgba(254,168,94,0.16)] bg-[radial-gradient(circle_at_top,rgba(255,103,56,0.18),transparent_42%),linear-gradient(135deg,#241917_0%,#17110f_100%)] px-8 py-12">
									<div className="mx-auto flex max-w-[460px] flex-col items-center text-center">
										<div className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#8f7e73]">
											{connectionSummary}
										</div>
										<div className="mt-3 text-sm text-[#c6b4a8]">{compactSummary}</div>
										<div className="mt-6 w-full">{artifactModeSelector}</div>
										{hasStoredToken ? (
											<div className="mt-5 border-t border-white/10 pt-4">
												<div className="text-xs font-medium uppercase tracking-[0.16em] text-[#8f7e73]">
													AI credits
												</div>
												<div className="mt-1 text-base font-semibold text-[#fff0e4]">
													{loadingCreditBalance
														? "Loading balance"
														: (creditBalanceText ?? "Balance unavailable")}
												</div>
												{creditBalanceDetail ? (
													<div className="mt-1 text-xs text-[#8f7e73]">{creditBalanceDetail}</div>
												) : null}
											</div>
										) : null}
										<Button
											type="button"
											onClick={() => void handlePrimaryAction()}
											disabled={hasStoredToken ? !videoPath || isWorking : false}
											className="mt-8 h-16 min-w-[340px] rounded-full bg-[#FF6738] px-8 text-lg font-semibold text-white hover:bg-[#FF6738]/90"
										>
											{!hasStoredToken ? (
												<LogIn className="mr-3 h-5 w-5" />
											) : (
												<Sparkles className="mr-3 h-5 w-5" />
											)}
											{primaryActionLabel}
										</Button>
										<div className="mt-5 flex flex-wrap items-center justify-center gap-4 text-sm">
											<button
												type="button"
												onClick={() => setShowSettingsDialog(true)}
												className="text-[#c6b4a8] underline-offset-4 hover:text-[#fff0e4] hover:underline"
											>
												Additional settings
											</button>
											{!hasStoredToken ? (
												<button
													type="button"
													onClick={() => void handleCreateAccount()}
													className="text-[#FEA85E] underline-offset-4 hover:underline"
												>
													Create account
												</button>
											) : null}
										</div>
									</div>
								</div>
								{historyPanel}
							</div>
						)}
					</div>

					<DialogFooter className="mt-4 border-t border-white/10 pt-4">
						{phase === "failed" ? (
							<Button
								type="button"
								onClick={() => void handleStart()}
								disabled={!videoPath || isWorking}
								className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
							>
								<RefreshCcw className="mr-2 h-4 w-4" />
								Run Analysis Again
							</Button>
						) : null}
						<Button
							type="button"
							variant="secondary"
							onClick={() => onOpenChange(false)}
							className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
						>
							Close
						</Button>
						{canManuallyGenerate ? (
							<Button
								type="button"
								onClick={() => void handleGenerate()}
								disabled={isWorking}
								className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
							>
								<Sparkles className="mr-2 h-4 w-4" />
								{artifactMode === "presentation" ? "Generate Presentation" : "Generate Docs"}
							</Button>
						) : null}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={showSettingsDialog} onOpenChange={setShowSettingsDialog}>
				<DialogContent className="max-h-[90vh] overflow-hidden border border-[rgba(254,168,94,0.18)] bg-[#17110f] text-[#fff0e4] sm:max-w-[860px]">
					<DialogHeader>
						<DialogTitle className="text-[#fff0e4]">Additional Settings</DialogTitle>
						<DialogDescription className="text-[#8f7e73]">
							Overrides, connection fallback, and job details.
						</DialogDescription>
					</DialogHeader>

					<div className="grid max-h-[calc(90vh-10rem)] gap-4 overflow-y-auto pr-1">
						<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
							<div className="mb-3 flex items-center justify-between">
								<div className="text-sm font-semibold text-[#fff0e4]">Workspace and output</div>
								<div className="flex gap-2">
									<Button
										type="button"
										variant="secondary"
										onClick={() => void loadCreditBalance()}
										disabled={loadingCreditBalance || !hasStoredToken}
										className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
									>
										{loadingCreditBalance ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<RefreshCcw className="mr-2 h-4 w-4" />
										)}
										Credits
									</Button>
									<Button
										type="button"
										variant="secondary"
										onClick={() => void handleRefreshWorkspaces()}
										disabled={loadingWorkspaces || !hasConnectionCredentials}
										className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
									>
										{loadingWorkspaces ? (
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										) : (
											<RefreshCcw className="mr-2 h-4 w-4" />
										)}
										Load Workspaces
									</Button>
									<Button
										type="button"
										variant="secondary"
										onClick={() => {
											void persistConfig()
												.then(() => toast.success("Docsie defaults saved"))
												.catch((error) => {
													toast.error(
														error instanceof Error
															? error.message
															: "Failed to save Docsie defaults",
													);
												});
										}}
										disabled={savingConfig || !hasConnectionCredentials}
										className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
									>
										{savingConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
										Save Defaults
									</Button>
								</div>
							</div>

							<div className="mb-4">{artifactModeSelector}</div>

							<div className="mb-4 rounded-xl border border-white/10 bg-[#17110f] p-3">
								<div className="mb-2 text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
									Intent
								</div>
								<div className="grid grid-cols-2 gap-2">
									<button
										type="button"
										onClick={() => setIntent("documentation")}
										className={cn(
											"rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
											intent === "documentation"
												? "border-[#FF6738] bg-[#FF6738]/15 text-[#fff0e4]"
												: "border-white/10 bg-white/[0.03] text-[#c6b4a8] hover:bg-white/[0.06]",
										)}
									>
										Documentation
									</button>
									<button
										type="button"
										onClick={() => {
											setIntent("export");
											setAutoPublishToKnowledgeBase(false);
										}}
										className={cn(
											"rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
											intent === "export"
												? "border-[#FF6738] bg-[#FF6738]/15 text-[#fff0e4]"
												: "border-white/10 bg-white/[0.03] text-[#c6b4a8] hover:bg-white/[0.06]",
										)}
									>
										Export only
									</button>
								</div>
								<div
									className={cn(
										"mt-3 flex items-center justify-between gap-4 rounded-lg border border-white/10 px-3 py-2",
										intent !== "documentation" && "opacity-60",
									)}
								>
									<span className="text-sm font-medium text-[#fff0e4]">
										Publish to knowledge base
									</span>
									<button
										type="button"
										onClick={() =>
											intent === "documentation" &&
											setAutoPublishToKnowledgeBase((current) => !current)
										}
										disabled={intent !== "documentation"}
										className={cn(
											"relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:cursor-not-allowed",
											publishToKnowledgeBase ? "bg-[#FF6738]" : "bg-white/10",
										)}
									>
										<span
											className={cn(
												"inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
												publishToKnowledgeBase ? "translate-x-5" : "translate-x-1",
											)}
										/>
									</button>
								</div>
							</div>

							<div className="grid gap-3 md:grid-cols-2">
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Workspace
									</label>
									<select
										value={workspaceId}
										onChange={(event) => {
											const nextWorkspaceId = event.target.value;
											setWorkspaceId(nextWorkspaceId);
											setTargetDocumentationId("");
											const nextWorkspace = workspaces.find(
												(workspace) => workspace.id === nextWorkspaceId,
											);
											setStoredWorkspaceName(nextWorkspace?.name ?? storedWorkspaceName);
											void loadDocumentationShelves(nextWorkspaceId);
										}}
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									>
										<option value="">Select a workspace</option>
										{workspaces.map((workspace) => (
											<option key={workspace.id} value={workspace.id}>
												{workspace.name}
											</option>
										))}
									</select>
								</div>
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Quality
									</label>
									<div className="space-y-1.5">
										<select
											value={quality}
											onChange={(event) =>
												setQuality(event.target.value as DocsieVideoToDocsQuality)
											}
											className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										>
											{QUALITY_OPTIONS.map((option) => (
												<option key={option.value} value={option.value}>
													{option.label} · {option.description}
												</option>
											))}
										</select>
										<div className="text-xs text-[#8f7e73]">
											{qualitySummary ||
												"Estimate loads after the recorder can read the video length."}
										</div>
									</div>
								</div>
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Language
									</label>
									<Input
										value={language}
										onChange={(event) => setLanguage(event.target.value)}
										placeholder="english"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
								{artifactMode === "docs" ? (
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Doc Style
										</label>
										<select
											value={docStyle}
											onChange={(event) =>
												setDocStyle(event.target.value as DocsieVideoToDocsDocStyle)
											}
											className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										>
											{DOC_STYLE_OPTIONS.map((option) => (
												<option key={option} value={option}>
													{option}
												</option>
											))}
										</select>
									</div>
								) : (
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Deck Type
										</label>
										<select
											value={pptxDeckType}
											onChange={(event) => setPptxDeckType(event.target.value)}
											className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										>
											{["training", "tutorial", "sales", "executive", "support", "onboarding"].map(
												(option) => (
													<option key={option} value={option}>
														{option}
													</option>
												),
											)}
										</select>
									</div>
								)}
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										{publishToKnowledgeBase ? "Book Title" : "Export Title"}
									</label>
									<Input
										value={bookTitle}
										onChange={(event) => setBookTitle(event.target.value)}
										placeholder="Video Documentation"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
								{publishToKnowledgeBase ? (
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Destination Shelf
										</label>
										<select
											value={targetDocumentationId}
											onChange={(event) => setTargetDocumentationId(event.target.value)}
											className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										>
											<option value="">Create a new shelf from the book title</option>
											{targetDocumentationId &&
											!documentationShelves.some((shelf) => shelf.id === targetDocumentationId) ? (
												<option value={targetDocumentationId}>
													Saved shelf ({targetDocumentationId})
												</option>
											) : null}
											{documentationShelves.map((shelf) => (
												<option key={shelf.id} value={shelf.id}>
													{shelf.name}
												</option>
											))}
										</select>
										<div className="flex items-center justify-between gap-3 text-xs text-[#8f7e73]">
											<span>
												{targetDocumentationId
													? "Docsie will add the generated book to this shelf."
													: "Docsie will create the shelf, then reuse it for future runs."}
											</span>
											<button
												type="button"
												onClick={() => void loadDocumentationShelves(workspaceId)}
												disabled={loadingShelves || !workspaceId}
												className="shrink-0 text-[#FEA85E] underline-offset-4 hover:underline disabled:text-[#8f7e73]"
											>
												{loadingShelves ? "Loading" : "Refresh"}
											</button>
										</div>
									</div>
								) : null}
								{artifactMode === "presentation" ? (
									<>
										<div className="space-y-1.5">
											<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
												Audience
											</label>
											<Input
												value={pptxAudience}
												onChange={(event) => setPptxAudience(event.target.value)}
												placeholder="support team"
												className="border-white/10 bg-[#17110f] text-[#fff0e4]"
											/>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
												Max Slides
											</label>
											<Input
												type="number"
												min={1}
												max={100}
												value={pptxMaxSlides}
												onChange={(event) => setPptxMaxSlides(event.target.value)}
												onBlur={() =>
													setPptxMaxSlides(String(normalizePptxMaxSlides(pptxMaxSlides)))
												}
												className="border-white/10 bg-[#17110f] text-[#fff0e4]"
											/>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
												Image Quality
											</label>
											<select
												value={pptxImageQuality}
												onChange={(event) =>
													setPptxImageQuality(event.target.value as DocsiePptxImageQuality)
												}
												className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
											>
												<option value="low">low</option>
												<option value="medium">medium</option>
												<option value="high">high</option>
											</select>
										</div>
										<div className="space-y-1.5">
											<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
												Illustration Style
											</label>
											<Input
												value={pptxIllustrationStyle}
												onChange={(event) => setPptxIllustrationStyle(event.target.value)}
												placeholder="corporate"
												className="border-white/10 bg-[#17110f] text-[#fff0e4]"
											/>
										</div>
									</>
								) : null}
							</div>

							<div className="mt-3 rounded-xl border border-white/10 bg-[#17110f] p-3">
								<label className="flex items-center justify-between gap-4">
									<div className="text-sm font-medium text-[#fff0e4]">
										{artifactMode === "presentation"
											? "Auto-generate presentation"
											: "Auto-generate docs"}
									</div>
									<button
										type="button"
										onClick={() => setAutoGenerate((current) => !current)}
										className={cn(
											"relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
											autoGenerate ? "bg-[#FF6738]" : "bg-white/10",
										)}
									>
										<span
											className={cn(
												"inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
												autoGenerate ? "translate-x-5" : "translate-x-1",
											)}
										/>
									</button>
								</label>
							</div>

							{artifactMode === "presentation" ? (
								<div className="mt-3 grid gap-3 md:grid-cols-2">
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Source Name
										</label>
										<Input
											value={pptxSourceName}
											onChange={(event) => setPptxSourceName(event.target.value)}
											placeholder="Screen Recorder"
											className="border-white/10 bg-[#17110f] text-[#fff0e4]"
										/>
									</div>
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Enhancement
										</label>
										<select
											value={pptxEnhance}
											onChange={(event) => setPptxEnhance(event.target.value)}
											className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										>
											<option value="required">required</option>
											<option value="enhanced">enhanced</option>
											<option value="standard">standard</option>
										</select>
									</div>
									<label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#17110f] p-3">
										<div className="text-sm font-medium text-[#fff0e4]">Generate cover image</div>
										<button
											type="button"
											onClick={() => setPptxGenerateCoverImage((current) => !current)}
											className={cn(
												"relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
												pptxGenerateCoverImage ? "bg-[#FF6738]" : "bg-white/10",
											)}
										>
											<span
												className={cn(
													"inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
													pptxGenerateCoverImage ? "translate-x-5" : "translate-x-1",
												)}
											/>
										</button>
									</label>
									<label className="flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#17110f] p-3">
										<div className="text-sm font-medium text-[#fff0e4]">Embed images</div>
										<button
											type="button"
											onClick={() => setPptxEmbedImages((current) => !current)}
											className={cn(
												"relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
												pptxEmbedImages ? "bg-[#FF6738]" : "bg-white/10",
											)}
										>
											<span
												className={cn(
													"inline-block h-5 w-5 transform rounded-full bg-white transition-transform",
													pptxEmbedImages ? "translate-x-5" : "translate-x-1",
												)}
											/>
										</button>
									</label>
								</div>
							) : null}

							<div className="mt-3 grid gap-3">
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Rewrite Instructions
									</label>
									<textarea
										value={rewriteInstructions}
										onChange={(event) => setRewriteInstructions(event.target.value)}
										className="min-h-24 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									/>
								</div>
								{artifactMode === "docs" ? (
									<div className="space-y-1.5">
										<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
											Output Template
										</label>
										<DocsieTemplatePicker
											templates={generationTemplates}
											isLoading={loadingTemplates}
											selectedTemplateId={generationTemplateId}
											onOpen={async () => {
												if (!hasConnectionCredentials) {
													toast.error("Connect this recorder to Docsie first");
													return false;
												}
												try {
													if (!hasStoredToken) {
														const state = await persistConfig();
														if (!state.hasToken) {
															toast.error("Save a Docsie API token before browsing templates");
															return false;
														}
													}
													await loadGenerationTemplates();
												} catch (error) {
													toast.error(error instanceof Error ? error.message : String(error));
													return false;
												}
											}}
											onSelect={(template) => {
												setGenerationTemplateId(template.id);
												toast.success(`Template selected: ${template.name}`);
											}}
											onClear={() => {
												setGenerationTemplateId("");
												toast.info("Template selection cleared");
											}}
										/>
										<div className="text-xs text-[#8f7e73]">
											{generationTemplateId
												? "The selected library template id is sent to Docsie. Custom text below is kept as a fallback only."
												: "Pick a library template or enter a custom structure below."}
										</div>
										<textarea
											value={templateInstruction}
											onChange={(event) => setTemplateInstruction(event.target.value)}
											placeholder="Optional custom structure when no library template is selected."
											className="min-h-24 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
										/>
									</div>
								) : null}
							</div>
						</div>

						{showAdvancedOutputs ? (
							<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
								<div className="mb-3 text-sm font-semibold text-[#fff0e4]">Job details</div>
								<div className="grid gap-3 sm:grid-cols-2">
									<div className="rounded-xl border border-white/10 bg-[#17110f] p-3">
										<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
											Analysis Job
										</div>
										<div className="mt-1 break-all text-xs text-[#fff0e4]">
											{analysisJobId ?? "Not started"}
										</div>
									</div>
									<div className="rounded-xl border border-white/10 bg-[#17110f] p-3">
										<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
											Generation Job
										</div>
										<div className="mt-1 break-all text-xs text-[#fff0e4]">
											{generationJobId ?? (autoGenerate ? "Waiting for analysis" : "Disabled")}
										</div>
									</div>
								</div>
							</div>
						) : null}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="secondary"
							onClick={() => setShowSettingsDialog(false)}
							className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
						>
							Close
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
