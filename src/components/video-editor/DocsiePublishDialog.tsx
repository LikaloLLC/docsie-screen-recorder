import {
	CheckCircle2,
	Copy,
	Download,
	ExternalLink,
	Loader2,
	LogIn,
	RefreshCcw,
	ShieldCheck,
	Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import type {
	DocsieAuthMode,
	DocsieEstimateResult,
	DocsieIntegrationState,
	DocsieOutputFormat,
	DocsieVideoToDocsDocStyle,
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

const GENERATION_OUTPUT_FORMATS: DocsieOutputFormat[] = ["md", "docx", "pdf"];
const EXPORT_FORMATS = ["docx", "pdf"] as const;

type PublishPhase = "idle" | "starting" | "analysis" | "generation" | "completed" | "failed";
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

function getEstimateText(estimate: DocsieEstimateResult | null) {
	if (!estimate?.success) {
		return null;
	}

	const credits = isRecord(estimate.estimate)
		? (estimate.estimate.total_credits ?? estimate.estimate.credits ?? null)
		: null;
	return typeof credits === "number" ? `${credits.toLocaleString()} credits` : null;
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

function getPrimaryResultUrl(jobResult: DocsieVideoToDocsJobResult | null) {
	return jobResult?.url ?? jobResult?.resultUrl ?? null;
}

function getResultTitle(jobResult: DocsieVideoToDocsJobResult | null) {
	return jobResult?.bookName ?? jobResult?.title ?? "Docsie result";
}

function normalizeMarkdownFileName(title: string) {
	return `${title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "docsie-result"}.md`;
}

function getDocsiePersistenceLabel(jobResult: DocsieVideoToDocsJobResult | null) {
	return [jobResult?.documentationName ?? jobResult?.bookName ?? null, jobResult?.articleId ?? null]
		.filter(Boolean)
		.join(" • ");
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
	return format.toUpperCase();
}

export function DocsiePublishDialog({
	isOpen,
	onOpenChange,
	videoPath,
	videoDurationSeconds,
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
	const [autoGenerate, setAutoGenerate] = useState(true);
	const [rewriteInstructions, setRewriteInstructions] = useState("");
	const [templateInstruction, setTemplateInstruction] = useState("");
	const [targetDocumentationId, setTargetDocumentationId] = useState("");
	const [bookTitle, setBookTitle] = useState("Video Documentation");
	const [workspaces, setWorkspaces] = useState<DocsieWorkspace[]>([]);
	const [savingConfig, setSavingConfig] = useState(false);
	const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
	const [loadingEstimate, setLoadingEstimate] = useState(false);
	const [estimate, setEstimate] = useState<DocsieEstimateResult | null>(null);
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
	const [showSettingsDialog, setShowSettingsDialog] = useState(false);

	const selectedWorkspace = useMemo(
		() => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
		[workspaceId, workspaces],
	);
	const displayedWorkspaceName = selectedWorkspace?.name ?? storedWorkspaceName;
	const hasConnectionCredentials = hasStoredToken || Boolean(tokenInput.trim());
	const estimateText = getEstimateText(estimate);
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
		setTemplateInstruction(state.defaultTemplateInstruction ?? "");
		setTargetDocumentationId(state.targetDocumentationId ?? "");
		setAutoGenerate(state.autoGenerate);

		if (state.hasToken) {
			const workspacesResult = await window.electronAPI.docsieListWorkspaces();
			if (workspacesResult.success) {
				setWorkspaces(workspacesResult.workspaces);
				if (!state.workspaceId && workspacesResult.workspaces.length > 0) {
					const firstWorkspace = workspacesResult.workspaces[0];
					setWorkspaceId(firstWorkspace.id);
					setStoredWorkspaceName(firstWorkspace.name);
				}
			}
		}
	}, []);

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
	}, [hasStoredToken, isOpen, quality, videoDurationSeconds]);

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
				defaultTemplateInstruction: templateInstruction,
				targetDocumentationId: targetDocumentationId.trim() || undefined,
				autoGenerate,
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
		autoGenerate,
		docStyle,
		language,
		organizationName,
		quality,
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
		const launchUrl = buildDocsieDesktopConnectUrl(webAppUrl, {
			workspaceId,
			docStyle,
			quality,
			language,
			templateInstruction,
			rewriteInstructions,
			targetDocumentationId,
			autoGenerate,
		});

		const result = await window.electronAPI.openExternalUrl(launchUrl);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie sign-in");
			return;
		}

		toast.success("Opened Docsie sign-in in your browser");
	}, [
		autoGenerate,
		docStyle,
		language,
		quality,
		rewriteInstructions,
		targetDocumentationId,
		templateInstruction,
		webAppUrl,
		workspaceId,
	]);

	const handleCreateAccount = useCallback(async () => {
		const launchUrl = buildDocsieDesktopSignupUrl(webAppUrl, {
			workspaceId,
			docStyle,
			quality,
			language,
			templateInstruction,
			rewriteInstructions,
			targetDocumentationId,
			autoGenerate,
		});

		const result = await window.electronAPI.openExternalUrl(launchUrl);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie sign-up");
			return;
		}

		toast.success("Opened Docsie sign-up in your browser");
	}, [
		autoGenerate,
		docStyle,
		language,
		quality,
		rewriteInstructions,
		targetDocumentationId,
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
			if (!workspaceId && result.workspaces.length > 0) {
				const firstWorkspace = result.workspaces[0];
				setWorkspaceId(firstWorkspace.id);
				setStoredWorkspaceName(firstWorkspace.name);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			setLoadingWorkspaces(false);
		}
	}, [hasConnectionCredentials, persistConfig, workspaceId]);

	const runGeneration = useCallback(
		async (sourceJobId: string) => {
			setBusyMessage("Docsie is generating markdown, PDF, and DOCX output.");

			const result = await window.electronAPI.docsieGenerateVideoToDocs({
				jobId: sourceJobId,
				docStyle,
				rewriteInstructions,
				templateInstruction,
				targetLanguage: language,
				targetDocumentationId: targetDocumentationId.trim() || undefined,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				outputFormats: GENERATION_OUTPUT_FORMATS,
			});

			if (!result.success || !result.generateJobId) {
				throw new Error(result.error ?? "Failed to start Docsie generation");
			}

			setGenerationJobId(result.generateJobId);
			setActiveJobId(result.generateJobId);
			setPhase("generation");
			setBusyMessage("Docsie is building the finished documentation and export files.");
			toast.success("Docsie generation started");
		},
		[
			bookTitle,
			docStyle,
			language,
			rewriteInstructions,
			targetDocumentationId,
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
	}, [activeJobId, autoGenerate, isOpen, phase, runGeneration]);

	useEffect(() => {
		const baseArtifacts = normalizeExportArtifacts(jobResult?.exports);
		setExportArtifacts(baseArtifacts);

		if (!jobResult?.exports || !Object.values(baseArtifacts).some((artifact) => artifact?.jobId)) {
			return;
		}

		let cancelled = false;
		let timeoutId: number | null = null;
		let currentArtifacts: Partial<Record<ExportFormat, ExportArtifact>> = { ...baseArtifacts };

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
				docStyle,
				rewriteInstructions,
				templateInstruction,
				targetDocumentationId: targetDocumentationId.trim() || undefined,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				autoGenerate: false,
			});

			if (!result.success || !result.jobId) {
				throw new Error(result.error ?? "Failed to start Docsie job");
			}

			setAnalysisJobId(result.jobId);
			setActiveJobId(result.jobId);
			setPhase("analysis");
			setBusyMessage(
				autoGenerate
					? "Docsie accepted the recording. Analysis is running before docs generation."
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
		autoGenerate,
		bookTitle,
		docStyle,
		hasConnectionCredentials,
		language,
		persistConfig,
		quality,
		rewriteInstructions,
		targetDocumentationId,
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
	const showAdvancedOutputs = isWorking || phase === "completed" || phase === "failed";
	const recordingSummary = videoPath ? videoPath.split("/").pop() : "No loaded recording";
	const docsiePersistenceLabel = getDocsiePersistenceLabel(jobResult);
	const primaryActionLabel = !hasStoredToken
		? "Log In To Docsie"
		: phase === "completed" && getPrimaryResultUrl(jobResult)
			? "Open In Docsie"
			: "Convert Video To Docs";
	const compactSummary = [
		hasStoredToken
			? displayedWorkspaceName || organizationName || "Docsie connected"
			: "Sign in required",
		recordingSummary,
		typeof videoDurationSeconds === "number" && videoDurationSeconds > 0
			? formatDuration(videoDurationSeconds)
			: null,
		estimateText,
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
												{formatJobPhase(phase)}
											</div>
											<div className="text-sm text-[#c6b4a8]">
												{busyMessage ?? "Docsie is preparing the current recording."}
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
												done:
													phase === "analysis" || phase === "generation" || phase === "completed",
											},
											{
												label: "Generate",
												active: phase === "generation" || phase === "completed",
												done: phase === "completed" || Boolean(generationJobId),
											},
											{
												label: "Exports",
												active: phase === "completed",
												done: Object.values(exportArtifacts).some(
													(artifact) => artifact?.status === "ready",
												),
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

									{phase === "completed" && getPrimaryResultUrl(jobResult) ? (
										<div className="mt-5 flex flex-wrap gap-2">
											<Button
												type="button"
												onClick={() => void handleOpenResult()}
												className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
											>
												<ExternalLink className="mr-2 h-4 w-4" />
												Open In Docsie
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

								{showAdvancedOutputs ? (
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
												<Button
													type="button"
													variant="secondary"
													onClick={() => setShowSettingsDialog(true)}
													className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
												>
													Additional settings
												</Button>
											</div>
										</div>

										<div className="grid gap-3 sm:grid-cols-3">
											<div className="rounded-xl border border-white/10 bg-[#17110f] p-3">
												<div className="flex items-start justify-between gap-3">
													<div>
														<div className="text-sm font-medium text-[#fff0e4]">Markdown</div>
														<div className="text-xs text-[#8f7e73]">
															{markdownReady ? "Ready" : "Pending"}
														</div>
													</div>
													{markdownReady ? (
														<div className="flex gap-2">
															<Button
																type="button"
																variant="secondary"
																onClick={() => void handleCopyMarkdown()}
																className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
															>
																<Copy className="mr-2 h-4 w-4" />
																Copy
															</Button>
															<Button
																type="button"
																variant="secondary"
																onClick={() => void handleDownloadMarkdown()}
																className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
															>
																<Download className="mr-2 h-4 w-4" />
																Save .md
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

											{EXPORT_FORMATS.map((format) => {
												const artifact = exportArtifacts[format];
												return (
													<div
														key={format}
														className="rounded-xl border border-white/10 bg-[#17110f] p-3"
													>
														<div className="flex items-start justify-between gap-3">
															<div>
																<div className="text-sm font-medium text-[#fff0e4]">
																	{getExportLabel(format)}
																</div>
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
																	variant="secondary"
																	onClick={() => void handleOpenExport(artifact)}
																	className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
																>
																	<Download className="mr-2 h-4 w-4" />
																	Download
																</Button>
															) : artifact?.status === "processing" ||
																artifact?.status === "queued" ? (
																<Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" />
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
													{typeof jobResult?.creditsCharged === "number"
														? ` • ${jobResult.creditsCharged.toLocaleString()} credits charged`
														: ""}
												</div>
											</div>
										) : null}
									</div>
								) : null}
							</div>
						) : (
							<div className="rounded-3xl border border-[rgba(254,168,94,0.16)] bg-[radial-gradient(circle_at_top,rgba(255,103,56,0.18),transparent_42%),linear-gradient(135deg,#241917_0%,#17110f_100%)] px-8 py-12">
								<div className="mx-auto flex max-w-[460px] flex-col items-center text-center">
									<div className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#8f7e73]">
										{connectionSummary}
									</div>
									<div className="mt-3 text-sm text-[#c6b4a8]">{compactSummary}</div>
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
						)}
					</div>

					<DialogFooter className="mt-4 border-t border-white/10 pt-4">
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
								Generate Docs
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

							<div className="grid gap-3 md:grid-cols-2">
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Workspace
									</label>
									<select
										value={workspaceId}
										onChange={(event) => {
											setWorkspaceId(event.target.value);
											const nextWorkspace = workspaces.find(
												(workspace) => workspace.id === event.target.value,
											);
											setStoredWorkspaceName(nextWorkspace?.name ?? storedWorkspaceName);
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
									<select
										value={quality}
										onChange={(event) => setQuality(event.target.value as DocsieVideoToDocsQuality)}
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									>
										{QUALITY_OPTIONS.map((option) => (
											<option key={option.value} value={option.value}>
												{option.label} · {option.description}
											</option>
										))}
									</select>
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
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Book Title
									</label>
									<Input
										value={bookTitle}
										onChange={(event) => setBookTitle(event.target.value)}
										placeholder="Video Documentation"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Target Shelf ID
									</label>
									<Input
										value={targetDocumentationId}
										onChange={(event) => setTargetDocumentationId(event.target.value)}
										placeholder="Optional documentation shelf ID"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
							</div>

							<div className="mt-3 rounded-xl border border-white/10 bg-[#17110f] p-3">
								<label className="flex items-center justify-between gap-4">
									<div className="text-sm font-medium text-[#fff0e4]">Auto-generate docs</div>
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
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Template Instruction
									</label>
									<textarea
										value={templateInstruction}
										onChange={(event) => setTemplateInstruction(event.target.value)}
										className="min-h-24 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									/>
								</div>
							</div>
						</div>

						<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
							<div className="mb-3 text-sm font-semibold text-[#fff0e4]">Connection fallback</div>
							<div className="grid gap-3 md:grid-cols-2">
								<div className="space-y-1.5 md:col-span-2">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Docsie URL
									</label>
									<Input
										value={webAppUrl}
										onChange={(event) => setWebAppUrl(event.target.value)}
										placeholder="https://app.docsie.io"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										API Base URL
									</label>
									<Input
										value={apiBaseUrl}
										onChange={(event) => setApiBaseUrl(event.target.value)}
										placeholder="https://app.docsie.io/api_v2/003"
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Auth Mode
									</label>
									<select
										value={authMode}
										onChange={(event) => setAuthMode(event.target.value as DocsieAuthMode)}
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									>
										<option value="bearer">Bearer</option>
										<option value="apiKey">Api-Key</option>
									</select>
								</div>
								<div className="space-y-1.5 md:col-span-2">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Token
									</label>
									<Input
										type="password"
										value={tokenInput}
										onChange={(event) => setTokenInput(event.target.value)}
										placeholder={
											hasStoredToken
												? "Leave blank to keep the saved token"
												: "Paste Docsie API token"
										}
										className="border-white/10 bg-[#17110f] text-[#fff0e4]"
									/>
								</div>
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
