import {
	ExternalLink,
	Loader2,
	LogIn,
	RefreshCcw,
	Send,
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
	DocsieVideoToDocsDocStyle,
	DocsieVideoToDocsJobResult,
	DocsieVideoToDocsJobStatus,
	DocsieVideoToDocsQuality,
	DocsieWorkspace,
} from "@/lib/docsieIntegration";
import { buildDocsieDesktopConnectUrl, getDocsieWebAppUrl } from "@/lib/docsieIntegration";
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

type PublishPhase = "idle" | "analysis" | "generation" | "completed" | "failed";

interface DocsiePublishDialogProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	videoPath: string | null;
	videoDurationSeconds?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractGenerateJobId(payload: unknown): string | null {
	if (!isRecord(payload)) {
		return null;
	}

	const value = payload.generate_job_id;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatJobPhase(phase: PublishPhase) {
	switch (phase) {
		case "analysis":
			return "Analyzing video";
		case "generation":
			return "Generating Docsie docs";
		case "completed":
			return "Completed";
		case "failed":
			return "Failed";
		default:
			return "Ready";
	}
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

	const selectedWorkspace = useMemo(
		() => workspaces.find((workspace) => workspace.id === workspaceId) ?? null,
		[workspaceId, workspaces],
	);
	const displayedWorkspaceName = selectedWorkspace?.name ?? storedWorkspaceName;
	const hasConnectionCredentials = hasStoredToken || Boolean(tokenInput.trim());

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
			const customEvent = event as CustomEvent<{ status?: string; message?: string }>;
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
			const queuedGenerateJobId = extractGenerateJobId(status.result);

			if (phase === "analysis" && queuedGenerateJobId && queuedGenerateJobId !== generationJobId) {
				setGenerationJobId(queuedGenerateJobId);
				setActiveJobId(queuedGenerateJobId);
				setPhase("generation");
				setBusyMessage("Analysis finished. Docsie is generating and saving the documentation.");
				return;
			}

			if (
				normalizedStatus === "done" ||
				normalizedStatus === "failed" ||
				normalizedStatus === "canceled"
			) {
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

				const followUpGenerateJobId = extractGenerateJobId(result.raw);
				if (
					phase === "analysis" &&
					autoGenerate &&
					followUpGenerateJobId &&
					followUpGenerateJobId !== generationJobId
				) {
					setGenerationJobId(followUpGenerateJobId);
					setActiveJobId(followUpGenerateJobId);
					setPhase("generation");
					setBusyMessage("Analysis completed. Docsie is generating and saving the documentation.");
					return;
				}

				setPhase("completed");
				setBusyMessage(null);
			}
		};

		void poll();
		const intervalId = window.setInterval(() => {
			void poll();
		}, 5000);

		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	}, [activeJobId, autoGenerate, generationJobId, isOpen, phase]);

	const persistConfig = async () => {
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
	};

	const handleConnect = async () => {
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
	};

	const handleRefreshWorkspaces = async () => {
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie or provide an API token first");
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
			const message = error instanceof Error ? error.message : String(error);
			toast.error(message);
		} finally {
			setLoadingWorkspaces(false);
		}
	};

	const handleEstimate = async () => {
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie or provide an API token first");
			return;
		}

		setLoadingEstimate(true);
		try {
			await persistConfig();
			const result = await window.electronAPI.docsieEstimateVideoToDocs({
				quality,
				...(typeof videoDurationSeconds === "number" && videoDurationSeconds > 0
					? { durationSeconds: videoDurationSeconds }
					: {}),
			});

			setEstimate(result);
			if (!result.success) {
				throw new Error(result.error ?? "Failed to estimate Docsie credits");
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			toast.error(message);
		} finally {
			setLoadingEstimate(false);
		}
	};

	const handleStart = async () => {
		if (!videoPath) {
			toast.error("No video available to send to Docsie");
			return;
		}
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie before sending this recording");
			return;
		}

		setBusyMessage("Uploading the current recording to Docsie.");
		setJobStatus(null);
		setJobResult(null);
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
				autoGenerate,
			});

			if (!result.success || !result.jobId) {
				throw new Error(result.error ?? "Failed to start Docsie job");
			}

			setAnalysisJobId(result.jobId);
			setActiveJobId(result.jobId);
			setPhase("analysis");
			setBusyMessage(
				autoGenerate
					? "Docsie accepted the recording. Analysis is running before documentation generation."
					: "Docsie accepted the recording. Analysis is running.",
			);
			toast.success("Recording sent to Docsie");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setPhase("failed");
			setBusyMessage(message);
			toast.error(message);
		}
	};

	const handleGenerate = async () => {
		if (!analysisJobId) {
			toast.error("Run the Docsie analysis step first");
			return;
		}
		if (!hasConnectionCredentials) {
			toast.error("Connect to Docsie before generating documentation");
			return;
		}

		setBusyMessage("Starting Docsie documentation generation.");
		try {
			await persistConfig();
			const result = await window.electronAPI.docsieGenerateVideoToDocs({
				jobId: analysisJobId,
				docStyle,
				rewriteInstructions,
				templateInstruction,
				targetLanguage: language,
				targetDocumentationId: targetDocumentationId.trim() || undefined,
				bookTitle: bookTitle.trim() || buildDefaultBookTitle(videoPath),
				outputFormats: ["md"],
			});

			if (!result.success || !result.generateJobId) {
				throw new Error(result.error ?? "Failed to start Docsie generation");
			}

			setGenerationJobId(result.generateJobId);
			setActiveJobId(result.generateJobId);
			setPhase("generation");
			setBusyMessage("Docsie is generating and saving the documentation.");
			toast.success("Docsie documentation generation started");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setPhase("failed");
			setBusyMessage(message);
			toast.error(message);
		}
	};

	const handleOpenResult = async () => {
		const url = getPrimaryResultUrl(jobResult);
		if (!url) {
			return;
		}

		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie result");
		}
	};

	const isWorking =
		savingConfig ||
		loadingWorkspaces ||
		loadingEstimate ||
		phase === "analysis" ||
		phase === "generation";
	const estimateText = getEstimateText(estimate);
	const resultPreview = jobResult?.markdown?.slice(0, 1200) ?? "";
	const canManuallyGenerate =
		phase === "completed" && !autoGenerate && Boolean(analysisJobId) && !generationJobId;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent
				className="sm:max-w-[980px] bg-[#17110f] text-[#fff0e4] border border-[rgba(254,168,94,0.18)]"
				style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
			>
				<DialogHeader>
					<DialogTitle className="text-[#fff0e4]">Publish To Docsie</DialogTitle>
					<DialogDescription className="text-[#c6b4a8]">
						Sign in with Docsie, choose where the recording should live, and run the video-to-docs
						pipeline from inside the editor.
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
					<div className="space-y-4">
						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 flex items-center justify-between">
								<div>
									<div className="text-sm font-semibold text-[#fff0e4]">Connection</div>
									<div className="text-xs text-[#c6b4a8]">
										Use the Docsie browser handoff instead of pasting credentials into the app.
									</div>
								</div>
								{loadingState ? <Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" /> : null}
							</div>

							<div className="grid gap-3 md:grid-cols-[1fr_auto]">
								<div className="space-y-1.5">
									<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
										Docsie URL
									</label>
									<Input
										value={webAppUrl}
										onChange={(event) => setWebAppUrl(event.target.value)}
										placeholder="https://app.docsie.io"
										className="border-white/10 bg-[#120d0c] text-[#fff0e4]"
									/>
								</div>
								<div className="flex items-end">
									<Button
										type="button"
										onClick={() => void handleConnect()}
										className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
									>
										<LogIn className="mr-2 h-4 w-4" />
										{hasStoredToken ? "Reconnect" : "Sign In"}
									</Button>
								</div>
							</div>

							<div className="mt-3 rounded-xl border border-white/10 bg-[#120d0c] p-3">
								<div className="flex items-start gap-3">
									<div
										className={cn(
											"mt-0.5 rounded-full p-1.5",
											hasStoredToken
												? "bg-[rgba(75,181,67,0.18)] text-[#8ce18b]"
												: "bg-white/10 text-[#c6b4a8]",
										)}
									>
										<ShieldCheck className="h-4 w-4" />
									</div>
									<div className="space-y-1">
										<div className="text-sm font-medium text-[#fff0e4]">
											{hasStoredToken
												? organizationName
													? `Connected to ${organizationName}`
													: "Connected to Docsie"
												: "Not connected yet"}
										</div>
										<div className="text-xs text-[#c6b4a8]">
											{hasStoredToken
												? displayedWorkspaceName
													? `Current workspace: ${displayedWorkspaceName}`
													: "Choose a workspace below before publishing."
												: "Launch the browser handoff to authorize this recorder for your Docsie organization."}
										</div>
									</div>
								</div>
							</div>

							<div className="mt-4 flex flex-wrap gap-2">
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
													error instanceof Error ? error.message : "Failed to save Docsie defaults",
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

							<details className="mt-4 rounded-xl border border-white/10 bg-[#120d0c] p-3">
								<summary className="cursor-pointer text-sm font-medium text-[#fff0e4]">
									Advanced API fallback
								</summary>
								<div className="mt-3 grid gap-3 md:grid-cols-2">
									<div className="space-y-1.5 md:col-span-2">
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
									<div className="space-y-1.5">
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
							</details>
						</div>

						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 text-sm font-semibold text-[#fff0e4]">
								Video To Docs Settings
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
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#120d0c] px-3 py-2 text-sm text-[#fff0e4] outline-none"
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
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#120d0c] px-3 py-2 text-sm text-[#fff0e4] outline-none"
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
										className="border-white/10 bg-[#120d0c] text-[#fff0e4]"
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
										className="flex h-10 w-full rounded-md border border-white/10 bg-[#120d0c] px-3 py-2 text-sm text-[#fff0e4] outline-none"
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
										className="border-white/10 bg-[#120d0c] text-[#fff0e4]"
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
										className="border-white/10 bg-[#120d0c] text-[#fff0e4]"
									/>
								</div>
							</div>

							<div className="mt-3 rounded-xl border border-white/10 bg-[#120d0c] p-3">
								<label className="flex items-center justify-between gap-4">
									<div>
										<div className="text-sm font-medium text-[#fff0e4]">Auto-generate docs</div>
										<div className="text-xs text-[#c6b4a8]">
											Run the rewrite and Docsie import step automatically after analysis. Turn this
											off only if you want to stop after raw analysis.
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
										className="min-h-24 w-full rounded-md border border-white/10 bg-[#120d0c] px-3 py-2 text-sm text-[#fff0e4] outline-none"
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
										className="min-h-24 w-full rounded-md border border-white/10 bg-[#120d0c] px-3 py-2 text-sm text-[#fff0e4] outline-none"
									/>
								</div>
							</div>
						</div>
					</div>

					<div className="space-y-4">
						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 flex items-center justify-between">
								<div>
									<div className="text-sm font-semibold text-[#fff0e4]">Current Recording</div>
									<div className="text-xs text-[#c6b4a8]">
										{videoPath ? videoPath.split("/").pop() : "No loaded recording"}
									</div>
								</div>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void handleEstimate()}
									disabled={loadingEstimate || !videoPath || !hasConnectionCredentials}
									className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
								>
									{loadingEstimate ? (
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
									) : (
										<RefreshCcw className="mr-2 h-4 w-4" />
									)}
									Estimate
								</Button>
							</div>

							<div className="grid gap-3 sm:grid-cols-2">
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Duration
									</div>
									<div className="mt-1 text-sm text-[#fff0e4]">
										{typeof videoDurationSeconds === "number"
											? `${videoDurationSeconds.toFixed(1)}s`
											: "Unknown"}
									</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
										Estimated Cost
									</div>
									<div className="mt-1 text-sm text-[#fff0e4]">
										{estimateText ?? "Run estimate"}
									</div>
									{estimate?.hasSufficientCredits === false ? (
										<div className="mt-1 text-xs text-[#FEA85E]">
											Credit balance is currently below the estimate.
										</div>
									) : null}
								</div>
							</div>
						</div>

						<div className="rounded-2xl border border-[rgba(254,168,94,0.14)] bg-[#201715] p-4">
							<div className="mb-3 flex items-center justify-between">
								<div>
									<div className="text-sm font-semibold text-[#fff0e4]">Job Status</div>
									<div className="text-xs text-[#c6b4a8]">{formatJobPhase(phase)}</div>
								</div>
								{isWorking ? <Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" /> : null}
							</div>

							<div className="space-y-3">
								<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
									<div className="text-xs text-[#c6b4a8]">
										{busyMessage ?? "Ready to send the current video through Docsie Video to Docs."}
									</div>
									{jobStatus?.status ? (
										<div className="mt-2 text-sm text-[#fff0e4]">
											API status: <span className="font-semibold">{jobStatus.status}</span>
										</div>
									) : null}
								</div>

								<div className="grid gap-3 sm:grid-cols-2">
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
											{generationJobId ?? (autoGenerate ? "Waiting" : "Disabled")}
										</div>
									</div>
								</div>

								{jobResult?.creditsCharged || jobResult?.creditBalanceAfter ? (
									<div className="grid gap-3 sm:grid-cols-2">
										<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
											<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
												Credits Charged
											</div>
											<div className="mt-1 text-sm text-[#fff0e4]">
												{jobResult.creditsCharged?.toLocaleString() ?? "Pending"}
											</div>
										</div>
										<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
											<div className="text-[11px] uppercase tracking-[0.16em] text-[#c6b4a8]">
												Balance After
											</div>
											<div className="mt-1 text-sm text-[#fff0e4]">
												{jobResult.creditBalanceAfter?.toLocaleString() ?? "Pending"}
											</div>
										</div>
									</div>
								) : null}

								{jobResult?.title ||
								jobResult?.bookName ||
								jobResult?.sessionId ||
								jobResult?.documentationName ||
								resultPreview ? (
									<div className="rounded-xl border border-white/10 bg-[#120d0c] p-3">
										<div className="flex items-start justify-between gap-3">
											<div>
												<div className="text-sm font-semibold text-[#fff0e4]">
													{getResultTitle(jobResult)}
												</div>
												{jobResult?.documentationName ? (
													<div className="mt-1 text-xs text-[#c6b4a8]">
														Shelf: {jobResult.documentationName}
													</div>
												) : null}
												{jobResult?.sessionId ? (
													<div className="mt-1 text-xs text-[#c6b4a8]">
														Session ID: {jobResult.sessionId}
													</div>
												) : null}
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
										{jobResult?.articlesCreated ? (
											<div className="mt-3 rounded-lg border border-white/10 bg-[#17110f] px-3 py-2 text-xs text-[#e8d6ca]">
												Docsie created {jobResult.articlesCreated} article
												{jobResult.articlesCreated === 1 ? "" : "s"}
												{jobResult.bookName ? ` in ${jobResult.bookName}.` : "."}
											</div>
										) : null}
										{resultPreview ? (
											<pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-[#17110f] p-3 text-xs text-[#e8d6ca]">
												{resultPreview}
											</pre>
										) : null}
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
							variant="secondary"
							onClick={() => void handleGenerate()}
							disabled={isWorking}
							className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
						>
							<Sparkles className="mr-2 h-4 w-4" />
							Generate Docs
						</Button>
					) : null}
					<Button
						type="button"
						onClick={() => void handleStart()}
						disabled={!videoPath || isWorking || !hasConnectionCredentials}
						className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
					>
						{isWorking ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Send className="mr-2 h-4 w-4" />
						)}
						Send To Docsie
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
