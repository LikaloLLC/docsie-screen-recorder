import {
	CheckCircle2,
	Copy,
	Download,
	ExternalLink,
	Loader2,
	LogIn,
	RefreshCcw,
	Send,
	ShieldCheck,
	Sparkles,
	UserPlus,
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

type PublishPhase = "idle" | "analysis" | "generation" | "completed" | "failed";
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

function formatNumber(value?: number | null) {
	if (typeof value !== "number" || Number.isNaN(value)) {
		return null;
	}

	return value.toLocaleString();
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

function getStepState(
	step: "analysis" | "generation" | "exports",
	phase: PublishPhase,
	autoGenerate: boolean,
	exportArtifacts: Partial<Record<ExportFormat, ExportArtifact>>,
) {
	if (phase === "failed") {
		return step === "analysis" || step === "generation" ? "failed" : "waiting";
	}

	if (step === "analysis") {
		if (phase === "idle") return "waiting";
		if (phase === "analysis") return "active";
		return "done";
	}

	if (step === "generation") {
		if (!autoGenerate) return "skipped";
		if (phase === "idle" || phase === "analysis") return "waiting";
		if (phase === "generation") return "active";
		return "done";
	}

	const hasExports = Object.keys(exportArtifacts).length > 0;
	const allReady =
		hasExports && Object.values(exportArtifacts).every((artifact) => artifact?.status === "ready");
	const anyFailed = Object.values(exportArtifacts).some(
		(artifact) => artifact?.status === "failed",
	);
	const anyProcessing = Object.values(exportArtifacts).some(
		(artifact) => artifact?.status === "processing" || artifact?.status === "queued",
	);

	if (!autoGenerate) return "skipped";
	if (phase === "completed" && allReady) return "done";
	if (phase === "completed" && anyFailed) return "failed";
	if ((phase === "generation" || phase === "completed") && (anyProcessing || hasExports))
		return "active";
	return "waiting";
}

function StepPill({
	label,
	state,
}: {
	label: string;
	state: "waiting" | "active" | "done" | "failed" | "skipped";
}) {
	return (
		<div
			className={cn(
				"rounded-xl border px-3 py-2 text-xs font-medium",
				state === "done" &&
					"border-[rgba(75,181,67,0.22)] bg-[rgba(75,181,67,0.12)] text-[#8ce18b]",
				state === "active" &&
					"border-[rgba(254,168,94,0.22)] bg-[rgba(254,168,94,0.12)] text-[#fff0e4]",
				state === "failed" &&
					"border-[rgba(255,103,56,0.22)] bg-[rgba(255,103,56,0.12)] text-[#ffb8a1]",
				state === "skipped" && "border-white/10 bg-[#120d0c] text-[#8f7e73]",
				state === "waiting" && "border-white/10 bg-[#120d0c] text-[#c6b4a8]",
			)}
		>
			{label}
		</div>
	);
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
	const [loadingState, setLoadingState] = useState(false);
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

	const selectedWorkspace = useMemo(
		() => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
		[workspaceId, workspaces],
	);
	const selectedQuality = useMemo(
		() => QUALITY_OPTIONS.find((option) => option.value === quality) ?? QUALITY_OPTIONS[1],
		[quality],
	);
	const displayedWorkspaceName = selectedWorkspace?.name ?? storedWorkspaceName;
	const hasConnectionCredentials = hasStoredToken || Boolean(tokenInput.trim());
	const estimateText = getEstimateText(estimate);
	const resultPreview = jobResult?.markdown?.slice(0, 1400) ?? "";
	const canManuallyGenerate =
		phase === "completed" && !autoGenerate && Boolean(analysisJobId) && !generationJobId;
	const isWorking =
		savingConfig ||
		loadingWorkspaces ||
		loadingEstimate ||
		phase === "analysis" ||
		phase === "generation";

	const loadState = useCallback(async () => {
		setLoadingState(true);
		try {
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
		} finally {
			setLoadingState(false);
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
		setPhase("idle");

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

		const blob = new Blob([jobResult.markdown], { type: "text/markdown;charset=utf-8" });
		const objectUrl = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = objectUrl;
		anchor.download = normalizeMarkdownFileName(getResultTitle(jobResult));
		document.body.append(anchor);
		anchor.click();
		anchor.remove();
		window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[1040px] border border-[rgba(254,168,94,0.18)] bg-[#17110f] text-[#fff0e4]">
				<DialogHeader>
					<DialogTitle className="text-[#fff0e4]">Convert Video To Docs</DialogTitle>
					<DialogDescription className="text-[#c6b4a8]">
						Send this recording through Docsie, let the existing video-to-docs pipeline run, then
						bring the finished outputs back here.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 lg:grid-cols-[1.12fr_0.88fr]">
					<div className="space-y-4">
						<div className="rounded-3xl border border-[rgba(254,168,94,0.16)] bg-[radial-gradient(circle_at_top,rgba(255,103,56,0.18),transparent_42%),linear-gradient(135deg,#241917_0%,#17110f_100%)] p-5">
							<div className="flex flex-wrap items-start justify-between gap-4">
								<div className="space-y-2">
									<div className="flex items-center gap-3">
										<div
											className={cn(
												"rounded-full border p-2.5",
												hasStoredToken
													? "border-[rgba(75,181,67,0.28)] bg-[rgba(75,181,67,0.12)] text-[#8ce18b]"
													: "border-[rgba(254,168,94,0.18)] bg-[rgba(254,168,94,0.08)] text-[#FEA85E]",
											)}
										>
											<ShieldCheck className="h-5 w-5" />
										</div>
										<div>
											<div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#FEA85E]">
												Docsie Conversion
											</div>
											<div className="text-xl font-semibold text-[#fff0e4]">
												{hasStoredToken ? "Ready to convert this recording" : "Sign in to continue"}
											</div>
										</div>
									</div>
									<p className="max-w-[42rem] text-sm leading-6 text-[#d8c4b5]">
										{hasStoredToken
											? "One click should run analysis, generation, and export creation. The internal tuning still exists, but it is tucked under advanced settings."
											: "The recorder should use your Docsie session, not ask for raw API setup. Connect it once, then convert recordings into docs from here."}
									</p>
								</div>

								<div className="flex flex-wrap gap-2">
									{hasStoredToken ? (
										<Button
											type="button"
											variant="secondary"
											onClick={() => void handleConnect()}
											className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
										>
											<RefreshCcw className="mr-2 h-4 w-4" />
											Reconnect
										</Button>
									) : (
										<>
											<Button
												type="button"
												onClick={() => void handleConnect()}
												className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
											>
												<LogIn className="mr-2 h-4 w-4" />
												Sign In
											</Button>
											<Button
												type="button"
												variant="secondary"
												onClick={() => void handleCreateAccount()}
												className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
											>
												<UserPlus className="mr-2 h-4 w-4" />
												Create Account
											</Button>
										</>
									)}
								</div>
							</div>

							<div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Connection
									</div>
									<div className="mt-1 text-sm font-medium text-[#fff0e4]">{connectionSummary}</div>
									<div className="mt-1 text-xs text-[#c6b4a8]">
										{displayedWorkspaceName
											? `Workspace: ${displayedWorkspaceName}`
											: "Pick a workspace below"}
									</div>
								</div>
								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Recording
									</div>
									<div className="mt-1 text-sm font-medium text-[#fff0e4]">
										{videoPath ? videoPath.split("/").pop() : "No loaded recording"}
									</div>
									<div className="mt-1 text-xs text-[#c6b4a8]">
										Duration: {formatDuration(videoDurationSeconds)}
									</div>
								</div>
								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Quality
									</div>
									<div className="mt-1 text-sm font-medium text-[#fff0e4]">
										{selectedQuality.label}
									</div>
									<div className="mt-1 text-xs text-[#c6b4a8]">{selectedQuality.description}</div>
								</div>
								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Estimated Cost
									</div>
									<div className="mt-1 flex items-center gap-2 text-sm font-medium text-[#fff0e4]">
										{loadingEstimate ? (
											<Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" />
										) : null}
										<span>{estimateText ?? "Calculating…"}</span>
									</div>
									{estimate?.hasSufficientCredits === false ? (
										<div className="mt-1 text-xs text-[#FEA85E]">
											Credits are currently below the estimate.
										</div>
									) : (
										<div className="mt-1 text-xs text-[#c6b4a8]">
											Credits are charged by Docsie when the job completes.
										</div>
									)}
								</div>
							</div>

							<div className="mt-5 rounded-3xl border border-[rgba(254,168,94,0.16)] bg-[rgba(255,255,255,0.03)] p-4">
								<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
									<div>
										<div className="text-lg font-semibold text-[#fff0e4]">
											{autoGenerate ? "Convert to Docs" : "Analyze Recording"}
										</div>
										<div className="mt-1 text-sm leading-6 text-[#d8c4b5]">
											{autoGenerate
												? "Docsie will analyze the video, generate the documentation, import it into Docsie, and queue DOCX/PDF exports."
												: "Analysis-only mode is enabled in advanced settings. Docsie will stop after the initial video breakdown."}
										</div>
									</div>

									<Button
										type="button"
										onClick={() => void handleStart()}
										disabled={!videoPath || isWorking || !hasConnectionCredentials}
										className="h-12 min-w-[220px] bg-[#FF6738] px-5 text-base font-semibold text-white hover:bg-[#FF6738]/90"
									>
										{isWorking ? (
											<Loader2 className="mr-2 h-5 w-5 animate-spin" />
										) : autoGenerate ? (
											<Sparkles className="mr-2 h-5 w-5" />
										) : (
											<Send className="mr-2 h-5 w-5" />
										)}
										{autoGenerate ? "Convert To Docs" : "Run Analysis"}
									</Button>
								</div>
							</div>
						</div>

						<details className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<summary className="cursor-pointer text-sm font-semibold text-[#fff0e4]">
								Advanced settings
							</summary>

							<div className="mt-4 grid gap-4">
								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
									<div className="mb-3 flex items-center justify-between">
										<div>
											<div className="text-sm font-semibold text-[#fff0e4]">
												Workspace and output
											</div>
											<div className="text-xs text-[#c6b4a8]">
												Keep the normal path simple. Use this only when you want to override
												defaults.
											</div>
										</div>
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
											<div>
												<div className="text-sm font-medium text-[#fff0e4]">Auto-generate docs</div>
												<div className="text-xs text-[#c6b4a8]">
													When enabled, the main button runs the whole docs pipeline and queues
													DOCX/PDF exports.
												</div>
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

									<div className="mt-3 grid gap-3">
										<div className="space-y-1.5">
											<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
												Rewrite Instructions
											</label>
											<textarea
												value={rewriteInstructions}
												onChange={(event) => setRewriteInstructions(event.target.value)}
												placeholder="Write for Docsie customers, keep the tone clear and product-focused."
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
												placeholder={
													"1. Overview\n2. Prerequisites\n3. Step-by-step instructions\n4. Troubleshooting"
												}
												className="min-h-24 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none"
											/>
										</div>
									</div>
								</div>

								<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
									<div className="mb-3 text-sm font-semibold text-[#fff0e4]">
										Connection fallback
									</div>
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
							</div>
						</details>
					</div>

					<div className="space-y-4">
						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 flex items-center justify-between">
								<div>
									<div className="text-sm font-semibold text-[#fff0e4]">Progress</div>
									<div className="text-xs text-[#c6b4a8]">{formatJobPhase(phase)}</div>
								</div>
								{isWorking || loadingState ? (
									<Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" />
								) : phase === "completed" ? (
									<CheckCircle2 className="h-4 w-4 text-[#8ce18b]" />
								) : null}
							</div>

							<div className="grid gap-2 sm:grid-cols-3">
								<StepPill
									label="1. Analyze"
									state={getStepState("analysis", phase, autoGenerate, exportArtifacts)}
								/>
								<StepPill
									label="2. Generate"
									state={getStepState("generation", phase, autoGenerate, exportArtifacts)}
								/>
								<StepPill
									label="3. Exports"
									state={getStepState("exports", phase, autoGenerate, exportArtifacts)}
								/>
							</div>

							<div className="mt-4 rounded-2xl border border-white/10 bg-[#120d0c] p-4">
								<div className="flex items-start gap-3">
									{isWorking ? (
										<div className="mt-0.5 rounded-full bg-[rgba(254,168,94,0.12)] p-2 text-[#FEA85E]">
											<Loader2 className="h-4 w-4 animate-spin" />
										</div>
									) : phase === "completed" ? (
										<div className="mt-0.5 rounded-full bg-[rgba(75,181,67,0.12)] p-2 text-[#8ce18b]">
											<CheckCircle2 className="h-4 w-4" />
										</div>
									) : (
										<div className="mt-0.5 rounded-full bg-white/10 p-2 text-[#c6b4a8]">
											<Sparkles className="h-4 w-4" />
										</div>
									)}
									<div className="space-y-2">
										<div className="text-sm font-medium text-[#fff0e4]">
											{busyMessage ?? "Ready to send the current video through Docsie."}
										</div>
										{jobStatus?.status ? (
											<div className="text-xs text-[#c6b4a8]">
												API status:{" "}
												<span className="font-semibold text-[#fff0e4]">{jobStatus.status}</span>
											</div>
										) : null}
										{isWorking ? (
											<div className="grid gap-2">
												<div className="h-2 rounded-full bg-white/10">
													<div className="h-2 w-2/3 animate-pulse rounded-full bg-[#FF6738]" />
												</div>
												<div className="grid gap-2 sm:grid-cols-2">
													<div className="h-12 animate-pulse rounded-xl bg-white/5" />
													<div className="h-12 animate-pulse rounded-xl bg-white/5" />
												</div>
											</div>
										) : null}
									</div>
								</div>
							</div>

							<div className="mt-4 grid gap-3 sm:grid-cols-2">
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Analysis Job
									</div>
									<div className="mt-1 break-all text-xs text-[#fff0e4]">
										{analysisJobId ?? "Not started"}
									</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Generation Job
									</div>
									<div className="mt-1 break-all text-xs text-[#fff0e4]">
										{generationJobId ?? (autoGenerate ? "Waiting for analysis" : "Disabled")}
									</div>
								</div>
							</div>

							{jobResult?.creditsCharged || jobResult?.creditBalanceAfter ? (
								<div className="mt-4 grid gap-3 sm:grid-cols-2">
									<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
										<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
											Credits Charged
										</div>
										<div className="mt-1 text-sm text-[#fff0e4]">
											{formatNumber(jobResult.creditsCharged) ?? "Pending"}
										</div>
									</div>
									<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
										<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
											Balance After
										</div>
										<div className="mt-1 text-sm text-[#fff0e4]">
											{formatNumber(jobResult.creditBalanceAfter) ?? "Pending"}
										</div>
									</div>
								</div>
							) : null}
						</div>

						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 flex items-start justify-between gap-3">
								<div>
									<div className="text-sm font-semibold text-[#fff0e4]">Outputs</div>
									<div className="text-xs text-[#c6b4a8]">
										Markdown comes back directly. DOCX and PDF are exposed as export downloads when
										ready.
									</div>
								</div>
								{getPrimaryResultUrl(jobResult) ? (
									<Button
										type="button"
										variant="secondary"
										onClick={() => void handleOpenResult()}
										className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
									>
										<ExternalLink className="mr-2 h-4 w-4" />
										Open In Docsie
									</Button>
								) : null}
							</div>

							<div className="grid gap-3">
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="mb-2 flex items-center justify-between gap-3">
										<div>
											<div className="text-sm font-medium text-[#fff0e4]">Markdown</div>
											<div className="text-xs text-[#c6b4a8]">
												{resultPreview
													? "Ready in the recorder preview."
													: "Available after conversion completes."}
											</div>
										</div>
										<div className="flex gap-2">
											<Button
												type="button"
												variant="secondary"
												onClick={() => void handleCopyMarkdown()}
												disabled={!jobResult?.markdown}
												className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
											>
												<Copy className="mr-2 h-4 w-4" />
												Copy
											</Button>
											<Button
												type="button"
												variant="secondary"
												onClick={() => void handleDownloadMarkdown()}
												disabled={!jobResult?.markdown}
												className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
											>
												<Download className="mr-2 h-4 w-4" />
												Save .md
											</Button>
										</div>
									</div>
									{resultPreview ? (
										<pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#17110f] p-3 text-xs text-[#e8d6ca]">
											{resultPreview}
										</pre>
									) : (
										<div className="rounded-lg border border-dashed border-white/10 px-3 py-6 text-center text-xs text-[#8f7e73]">
											Markdown preview will appear here after Docsie finishes.
										</div>
									)}
								</div>

								<div className="grid gap-3 sm:grid-cols-2">
									{EXPORT_FORMATS.map((format) => {
										const artifact = exportArtifacts[format];
										return (
											<div
												key={format}
												className="rounded-xl border border-white/10 bg-[#120d0c] p-3"
											>
												<div className="flex items-start justify-between gap-3">
													<div>
														<div className="text-sm font-medium text-[#fff0e4]">
															{getExportLabel(format)}
														</div>
														<div className="mt-1 text-xs text-[#c6b4a8]">
															{artifact?.status === "ready"
																? "Ready to download"
																: artifact?.status === "failed"
																	? (artifact.error ?? "Export failed")
																	: artifact?.status === "processing"
																		? "Docsie is preparing the file"
																		: artifact?.status === "queued"
																			? "Export has been queued"
																			: "Will appear here after generation"}
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
													) : artifact?.status === "processing" || artifact?.status === "queued" ? (
														<Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" />
													) : null}
												</div>
												{artifact?.jobId ? (
													<div className="mt-3 break-all text-[11px] text-[#8f7e73]">
														Export job: {artifact.jobId}
													</div>
												) : null}
											</div>
										);
									})}
								</div>

								{jobResult?.articlesCreated ? (
									<div className="rounded-xl border border-[rgba(75,181,67,0.2)] bg-[rgba(75,181,67,0.08)] px-3 py-2 text-sm text-[#d8f5d6]">
										Docsie created {jobResult.articlesCreated} article
										{jobResult.articlesCreated === 1 ? "" : "s"}
										{jobResult.bookName ? ` in ${jobResult.bookName}.` : "."}
									</div>
								) : null}
							</div>
						</div>
					</div>
				</div>

				<DialogFooter>
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
	);
}
