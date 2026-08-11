import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useI18n, useScopedT } from "@/contexts/I18nContext";
import { useScreenRecorder } from "@/hooks/useScreenRecorder";
import { LOCALE_STORAGE_KEY } from "@/i18n/config";
import type {
	DocsieGenerationTemplate,
	DocsieIntegrationState,
	DocsieVideoToDocsJobResult,
	DocsieVideoToDocsQuality,
} from "@/lib/docsieIntegration";
import { buildDocsieDesktopLoginUrl, getDocsieWebAppUrl } from "@/lib/docsieIntegration";

const SETTINGS_STORAGE_KEY = "docsie-companion-settings";
const DEFAULT_MATCH_RULE = "Viewer";
const SOURCE_SCAN_INTERVAL_MS = 8000;
const JOB_POLL_INTERVAL_MS = 5000;
const EXPORT_POLL_INTERVAL_MS = 5000;
const EXPORT_POLL_MAX_ATTEMPTS = 60;

type ReturnFormat = "kb" | "pdf";

type TranslateFn = (key: string, vars?: Record<string, string | number>) => string;

// The companion window is frameless; these mark regions as draggable chrome.
const dragRegionStyle = { WebkitAppRegion: "drag" } as CSSProperties;
const noDragRegionStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

type CompanionSettings = {
	matchRule: string;
	returnFormat: ReturnFormat;
	quality: DocsieVideoToDocsQuality;
	language: string;
	languageManuallySet: boolean;
	generationTemplateId: string;
	setupComplete: boolean;
};

// Docsie's video-to-docs API takes plain language names. The default follows
// the app UI locale unless the user explicitly chooses a different document
// language.
const LANGUAGE_OPTIONS = [
	{ value: "english", label: "English" },
	{ value: "japanese", label: "日本語 (Japanese)" },
	{ value: "german", label: "Deutsch (German)" },
	{ value: "french", label: "Français (French)" },
	{ value: "spanish", label: "Español (Spanish)" },
	{ value: "portuguese", label: "Português (Portuguese)" },
	{ value: "italian", label: "Italiano (Italian)" },
	{ value: "chinese", label: "中文 (Chinese)" },
	{ value: "korean", label: "한국어 (Korean)" },
	{ value: "turkish", label: "Türkçe (Turkish)" },
] as const;

const LOCALE_LANGUAGE_MAP: Record<string, string> = {
	en: "english",
	ja: "japanese",
	de: "german",
	fr: "french",
	es: "spanish",
	pt: "portuguese",
	it: "italian",
	zh: "chinese",
	ko: "korean",
	tr: "turkish",
};

function getDocumentLanguageForLocale(locale: string | null | undefined): string {
	const normalized = (locale || "en").toLowerCase();
	if (normalized.startsWith("zh")) return "chinese";
	const prefix = normalized.split("-")[0];
	return LOCALE_LANGUAGE_MAP[prefix] ?? "english";
}

function detectSystemLanguage(): string {
	return getDocumentLanguageForLocale(navigator.language || "en");
}

function detectPreferredDocumentLanguage(): string {
	try {
		const storedLocale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
		if (storedLocale) {
			return getDocumentLanguageForLocale(storedLocale);
		}
	} catch {
		// Fall back to browser/system locale.
	}
	return detectSystemLanguage();
}

type PublishPhase =
	| "idle"
	| "starting"
	| "analysis"
	| "generation"
	| "exporting"
	| "done"
	| "failed";

type PublishResult = {
	kbUrl: string | null;
	pdfUrl: string | null;
	title: string | null;
};

function loadSettings(): CompanionSettings {
	try {
		const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<CompanionSettings>;
			const languageManuallySet = parsed.languageManuallySet === true;
			return {
				matchRule: typeof parsed.matchRule === "string" ? parsed.matchRule : DEFAULT_MATCH_RULE,
				returnFormat: parsed.returnFormat === "pdf" ? "pdf" : "kb",
				quality:
					parsed.quality === "draft" ||
					parsed.quality === "standard" ||
					parsed.quality === "detailed" ||
					parsed.quality === "ultra"
						? parsed.quality
						: "standard",
				language:
					languageManuallySet && typeof parsed.language === "string" && parsed.language.trim()
						? parsed.language
						: detectPreferredDocumentLanguage(),
				languageManuallySet,
				generationTemplateId:
					typeof parsed.generationTemplateId === "string" ? parsed.generationTemplateId : "",
				setupComplete: parsed.setupComplete === true,
			};
		}
	} catch {
		// Fall through to defaults.
	}
	return {
		matchRule: DEFAULT_MATCH_RULE,
		returnFormat: "kb",
		quality: "standard",
		language: detectPreferredDocumentLanguage(),
		languageManuallySet: false,
		generationTemplateId: "",
		setupComplete: false,
	};
}

function persistSettings(settings: CompanionSettings) {
	try {
		window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
	} catch {
		// Storage may be unavailable; settings just won't persist.
	}
}

function formatElapsed(totalSeconds: number) {
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function defaultSessionTitle(t: TranslateFn) {
	const now = new Date();
	return t("session.defaultTitle", {
		date: now.toLocaleDateString(),
		time: now.toLocaleTimeString([], {
			hour: "2-digit",
			minute: "2-digit",
		}),
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function sleep(ms: number) {
	return new Promise<void>((resolve) => {
		window.setTimeout(resolve, ms);
	});
}

async function pollJobUntilDone(
	jobId: string,
	t: TranslateFn,
): Promise<DocsieVideoToDocsJobResult> {
	for (;;) {
		const status = await window.electronAPI.docsieGetJobStatus(jobId);
		if (!status.success) {
			throw new Error(status.error ?? t("errors.pollStatusFailed"));
		}

		const normalized = (status.normalizedStatus ?? status.status ?? "").toLowerCase();
		if (normalized === "failed" || normalized === "canceled") {
			const failedResult = await window.electronAPI.docsieGetJobResult(jobId);
			throw new Error(
				failedResult.error ?? status.error ?? t("errors.jobEnded", { status: normalized }),
			);
		}

		if (normalized === "done") {
			const result = await window.electronAPI.docsieGetJobResult(jobId);
			if (!result.success) {
				throw new Error(result.error ?? t("errors.fetchResultFailed"));
			}
			return result;
		}

		await sleep(JOB_POLL_INTERVAL_MS);
	}
}

async function resolvePdfExportUrl(
	result: DocsieVideoToDocsJobResult,
	t: TranslateFn,
): Promise<string | null> {
	const exports = result.exports;
	if (!isRecord(exports)) {
		return null;
	}

	const pdfEntry = exports["pdf"];
	if (!isRecord(pdfEntry)) {
		return null;
	}

	const directUrl = asString(pdfEntry.url);
	if (directUrl) {
		return directUrl;
	}

	const exportJobId = asString(pdfEntry.job_id) ?? asString(pdfEntry.jobId);
	if (!exportJobId) {
		return null;
	}

	for (let attempt = 0; attempt < EXPORT_POLL_MAX_ATTEMPTS; attempt += 1) {
		const exportJob = await window.electronAPI.docsieGetBackgroundJob(exportJobId);
		if (exportJob.success) {
			const normalized = (exportJob.status ?? "").toLowerCase();
			const payload = exportJob.result;
			const url = isRecord(payload) ? asString(payload.url) : null;
			if (normalized === "done" && url) {
				return url;
			}
			if (normalized === "failed" || normalized === "canceled") {
				const error = isRecord(payload) ? asString(payload.error) : null;
				throw new Error(error ?? t("errors.pdfExportEnded", { status: normalized }));
			}
		}
		await sleep(EXPORT_POLL_INTERVAL_MS);
	}

	throw new Error(t("errors.pdfExportTimeout"));
}

function CompanionShell({ children }: { children: ReactNode }) {
	const t = useScopedT("companion");
	return (
		<div className="w-screen h-screen bg-transparent p-2 font-sans">
			<div className="w-full h-full rounded-xl border border-white/10 bg-[#101014] shadow-2xl overflow-hidden flex flex-col text-white/90">
				<div
					className="flex items-center justify-between pl-4 pr-2 h-10 flex-none border-b border-white/5"
					style={dragRegionStyle}
				>
					<span className="text-[11px] font-medium text-white/50 tracking-wide">
						{t("shell.title")}
					</span>
					<div className="flex items-center gap-1" style={noDragRegionStyle}>
						<button
							type="button"
							onClick={() => void window.electronAPI.minimizeCurrentWindow()}
							title={t("shell.minimize")}
							className="w-7 h-7 rounded-md text-white/60 hover:bg-white/10 hover:text-white text-sm leading-none"
						>
							–
						</button>
						<button
							type="button"
							onClick={() => void window.electronAPI.closeCurrentWindow()}
							title={t("shell.close")}
							className="w-7 h-7 rounded-md text-white/60 hover:bg-red-500/80 hover:text-white text-sm leading-none"
						>
							×
						</button>
					</div>
				</div>
				<div className="flex-1 overflow-y-auto">{children}</div>
			</div>
		</div>
	);
}

/**
 * Kiosk-style capture window: attach to a configured application window,
 * record it with trainer narration, and auto-publish the recording through
 * Docsie Video-to-Docs using the connection defaults saved at setup time.
 */
export function CaptureCompanion() {
	const t = useScopedT("companion");
	const { locale } = useI18n();
	const [docsieState, setDocsieState] = useState<DocsieIntegrationState | null>(null);
	const [settings, setSettings] = useState<CompanionSettings>(() => loadSettings());
	const [attachedSource, setAttachedSource] = useState<ProcessedDesktopSource | null>(null);
	const [availableSources, setAvailableSources] = useState<ProcessedDesktopSource[]>([]);
	const [sessionTitle, setSessionTitle] = useState("");
	const [publishPhase, setPublishPhase] = useState<PublishPhase>("idle");
	const [statusText, setStatusText] = useState("");
	const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
	const [showSettings, setShowSettings] = useState(false);

	const settingsRef = useRef(settings);
	settingsRef.current = settings;
	const docsieStateRef = useRef(docsieState);
	docsieStateRef.current = docsieState;
	const sessionTitleRef = useRef(sessionTitle);
	sessionTitleRef.current = sessionTitle;
	const publishPhaseRef = useRef(publishPhase);
	publishPhaseRef.current = publishPhase;
	const tRef = useRef(t);
	tRef.current = t;

	useEffect(() => {
		document.title = t("shell.title");
	}, [t]);

	const refreshDocsieState = useCallback(async () => {
		const response = await window.electronAPI.docsieGetState();
		if (response.success && response.state) {
			setDocsieState(response.state);
		}
	}, []);

	useEffect(() => {
		void refreshDocsieState();
		const onAuthEvent = () => {
			void refreshDocsieState();
		};
		window.addEventListener("docsie-desktop-auth-event", onAuthEvent);
		return () => {
			window.removeEventListener("docsie-desktop-auth-event", onAuthEvent);
		};
	}, [refreshDocsieState]);

	const [templates, setTemplates] = useState<DocsieGenerationTemplate[]>([]);
	const hasToken = Boolean(docsieState?.hasToken);
	useEffect(() => {
		if (!hasToken) {
			return;
		}
		let cancelled = false;
		void window.electronAPI.docsieListGenerationTemplates().then((response) => {
			if (!cancelled && response.success) {
				setTemplates(response.templates);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [hasToken]);

	const publishRecording = useCallback(async (videoPath: string) => {
		const translate = tRef.current;
		const state = docsieStateRef.current;
		const activeSettings = settingsRef.current;
		const bookTitle = sessionTitleRef.current.trim() || defaultSessionTitle(translate);
		const outputFormats = activeSettings.returnFormat === "pdf" ? (["pdf"] as const) : undefined;
		const language = activeSettings.language || state?.defaultLanguage || "english";
		const generationTemplateId =
			activeSettings.generationTemplateId || state?.defaultGenerationTemplateId || undefined;

		try {
			setPublishResult(null);
			setPublishPhase("starting");
			setStatusText(translate("progress.uploading"));

			const start = await window.electronAPI.docsieStartVideoToDocs({
				videoPath,
				quality: activeSettings.quality,
				language,
				workspaceId: state?.workspaceId,
				docStyle: state?.defaultDocStyle ?? "sop",
				generationTemplateId,
				intent: "documentation",
				targetDocumentationId: state?.targetDocumentationId || undefined,
				autoPublishToKnowledgeBase: activeSettings.returnFormat === "kb",
				bookTitle,
				autoGenerate: false,
				outputFormats: outputFormats ? [...outputFormats] : undefined,
			});
			if (!start.success || !start.jobId) {
				throw new Error(start.error ?? translate("errors.startJobFailed"));
			}

			setPublishPhase("analysis");
			setStatusText(translate("progress.analyzing"));
			const analysis = await pollJobUntilDone(start.jobId, translate);

			setPublishPhase("generation");
			setStatusText(translate("progress.generating"));
			const generate = await window.electronAPI.docsieGenerateVideoToDocs({
				jobId: analysis.jobId ?? start.jobId,
				docStyle: state?.defaultDocStyle ?? "sop",
				targetLanguage: language,
				generationTemplateId,
				targetDocumentationId: state?.targetDocumentationId || undefined,
				autoPublishToKnowledgeBase: activeSettings.returnFormat === "kb",
				bookTitle,
				outputFormats: outputFormats ? [...outputFormats] : undefined,
			});
			if (!generate.success || !generate.generateJobId) {
				throw new Error(generate.error ?? translate("errors.startGenerationFailed"));
			}

			const result = await pollJobUntilDone(generate.generateJobId, translate);

			let pdfUrl: string | null = null;
			if (activeSettings.returnFormat === "pdf") {
				setPublishPhase("exporting");
				setStatusText(translate("progress.preparingPdf"));
				pdfUrl = await resolvePdfExportUrl(result, translate);
			}

			setPublishResult({
				kbUrl: result.url ?? null,
				pdfUrl,
				title: result.title ?? bookTitle,
			});
			setPublishPhase("done");
			setStatusText(translate("progress.done"));
			toast.success(translate("toast.docsReady"));

			void window.electronAPI.docsieSaveVideoToDocsHistory({
				videoPath,
				bookTitle,
				quality: activeSettings.quality,
				docStyle: state?.defaultDocStyle ?? "sop",
				generationTemplateId,
				language,
				targetDocumentationId: state?.targetDocumentationId || undefined,
				autoPublishToKnowledgeBase: activeSettings.returnFormat === "kb",
				analysisJobId: start.jobId,
				generationJobId: generate.generateJobId,
				jobResult: result,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setPublishPhase("failed");
			setStatusText(message);
			toast.error(message);
		}
	}, []);

	const handleRecordingFinalized = useCallback(
		async (info: { path: string | null }) => {
			if (!info.path) {
				setPublishPhase("failed");
				setStatusText(tRef.current("errors.noVideoProduced"));
				return;
			}
			await publishRecording(info.path);
		},
		[publishRecording],
	);

	const {
		recording,
		elapsedSeconds,
		toggleRecording,
		cancelRecording,
		microphoneEnabled,
		setMicrophoneEnabled,
	} = useScreenRecorder({ onRecordingFinalized: handleRecordingFinalized });

	// Trainer narration is the whole point of the companion flow, so the
	// microphone defaults to on (the toggle below can still disable it).
	const micDefaultApplied = useRef(false);
	useEffect(() => {
		if (!micDefaultApplied.current) {
			micDefaultApplied.current = true;
			setMicrophoneEnabled(true);
		}
	}, [setMicrophoneEnabled]);

	// Collapse the window into the bottom recording bar while capturing.
	useEffect(() => {
		void window.electronAPI.companionSetRecordingBar(recording);
	}, [recording]);

	const scanForSource = useCallback(async () => {
		try {
			const sources = await window.electronAPI.getSources({
				types: ["window", "screen"],
				thumbnailSize: { width: 320, height: 180 },
				fetchWindowIcons: true,
			});
			setAvailableSources(sources);

			const rule = settingsRef.current.matchRule.trim().toLowerCase();
			if (!rule) {
				return;
			}
			const match = sources.find(
				(source) =>
					source.name.toLowerCase().includes(rule) &&
					!source.name.toLowerCase().includes("capture companion"),
			);
			if (match) {
				await window.electronAPI.selectSource(match);
				setAttachedSource(match);
			} else {
				setAttachedSource(null);
			}
		} catch (error) {
			console.warn("Companion source scan failed:", error);
		}
	}, []);

	useEffect(() => {
		void scanForSource();
		const timer = window.setInterval(() => {
			if (!recording && publishPhaseRef.current === "idle") {
				void scanForSource();
			}
		}, SOURCE_SCAN_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
		};
	}, [scanForSource, recording]);

	const handleManualSelect = useCallback(async (sourceId: string) => {
		const source =
			availableSourcesRef.current.find((candidate) => candidate.id === sourceId) ?? null;
		if (!source) {
			return;
		}
		await window.electronAPI.selectSource(source);
		setAttachedSource(source);
	}, []);
	const availableSourcesRef = useRef(availableSources);
	availableSourcesRef.current = availableSources;

	const handleConnect = useCallback(() => {
		const loginUrl = buildDocsieDesktopLoginUrl(
			getDocsieWebAppUrl(docsieStateRef.current?.apiBaseUrl),
		);
		void window.electronAPI.openExternalUrl(loginUrl);
	}, []);

	const updateSettings = useCallback((partial: Partial<CompanionSettings>) => {
		setSettings((current) => {
			const next = { ...current, ...partial };
			persistSettings(next);
			return next;
		});
	}, []);

	useEffect(() => {
		if (settings.languageManuallySet) {
			return;
		}
		const languageForLocale = getDocumentLanguageForLocale(locale);
		if (settings.language !== languageForLocale) {
			updateSettings({ language: languageForLocale });
		}
	}, [locale, settings.language, settings.languageManuallySet, updateSettings]);

	const resetForNextSession = useCallback(() => {
		setPublishPhase("idle");
		setPublishResult(null);
		setStatusText("");
		setSessionTitle("");
	}, []);

	const connected = Boolean(docsieState?.hasToken);
	const busyPublishing =
		publishPhase === "starting" ||
		publishPhase === "analysis" ||
		publishPhase === "generation" ||
		publishPhase === "exporting";
	const canRecord = connected && Boolean(attachedSource) && !busyPublishing;

	const progressSteps: Array<{ key: PublishPhase; label: string }> = [
		{ key: "starting", label: t("progress.upload") },
		{ key: "analysis", label: t("progress.analyze") },
		{ key: "generation", label: t("progress.generate") },
		...(settings.returnFormat === "pdf"
			? [{ key: "exporting" as PublishPhase, label: t("progress.pdfExport") }]
			: []),
	];
	const phaseOrder: PublishPhase[] = ["starting", "analysis", "generation", "exporting", "done"];
	const phaseIndex = phaseOrder.indexOf(publishPhase);

	// While recording, the window is a slim bottom bar (resized by the main
	// process) — render only the bar controls.
	if (recording) {
		return (
			<div className="w-screen h-screen bg-transparent flex items-center justify-center font-sans">
				<div
					className="flex items-center gap-3 w-full mx-3 h-16 rounded-full bg-[#101014]/95 border border-white/10 shadow-2xl px-5 select-none overflow-hidden text-white/90"
					style={dragRegionStyle}
				>
					<span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-none" />
					<span className="font-mono text-sm tabular-nums flex-none">
						{formatElapsed(elapsedSeconds)}
					</span>
					<span className="text-xs text-white/50 truncate flex-1">
						{attachedSource?.name ?? ""}
					</span>
					<div className="flex items-center gap-2 flex-none" style={noDragRegionStyle}>
						<button
							type="button"
							onClick={toggleRecording}
							className="px-5 py-2 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs font-semibold"
						>
							{t("record.stop")}
						</button>
						<button
							type="button"
							onClick={cancelRecording}
							className="px-4 py-2 rounded-full border border-white/15 text-xs hover:bg-white/10"
						>
							{t("record.cancel")}
						</button>
					</div>
				</div>
			</div>
		);
	}

	// First run (or gear button) shows the full setup surface. Once setup is
	// confirmed, every later launch boots straight into the minimal recorder.
	const inSetup = !settings.setupComplete || showSettings;

	if (inSetup) {
		return (
			<CompanionShell>
				<div className="max-w-md mx-auto px-5 py-6 flex flex-col gap-4">
					<header>
						<h1 className="text-lg font-semibold tracking-tight">{t("setup.title")}</h1>
						<p className="text-xs text-white/50">{t("setup.subtitle")}</p>
					</header>

					<section className="rounded-lg border border-white/10 bg-white/5 p-4 text-sm flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<span className="text-xs text-white/60">{t("setup.accountStep")}</span>
							{connected ? (
								<span className="text-xs text-emerald-300">{t("setup.connected")}</span>
							) : (
								<span className="text-xs text-amber-300">{t("setup.notConnected")}</span>
							)}
						</div>
						{connected ? (
							<div className="text-xs text-white/70">
								{docsieState?.organizationName ?? t("setup.organizationFallback")}
								{docsieState?.workspaceName ? ` / ${docsieState.workspaceName}` : ""}
							</div>
						) : (
							<button
								type="button"
								onClick={handleConnect}
								className="self-start px-3 py-1.5 rounded-md bg-[#FF6738] text-white text-xs font-medium hover:opacity-90"
							>
								{t("setup.connect")}
							</button>
						)}
					</section>

					<section className="rounded-lg border border-white/10 bg-white/5 p-4 flex flex-col gap-3 text-sm">
						<span className="text-xs text-white/60">{t("setup.defaultsStep")}</span>
						<label className="flex flex-col gap-1">
							<span className="text-xs text-white/60">{t("source.matchLabel")}</span>
							<input
								value={settings.matchRule}
								onChange={(event) => updateSettings({ matchRule: event.target.value })}
								placeholder={t("source.matchPlaceholder")}
								className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 outline-none focus:border-white/40"
							/>
						</label>
						{attachedSource ? (
							<div className="flex items-center gap-2 text-xs text-emerald-200">
								<span className="w-2 h-2 rounded-full bg-emerald-400" />
								{t("source.attached", { name: attachedSource.name })}
							</div>
						) : (
							<div className="text-xs text-amber-200/90">{t("source.noMatch")}</div>
						)}
						<label className="flex flex-col gap-1">
							<span className="text-[11px] text-white/45">{t("source.manualLabel")}</span>
							<select
								value={attachedSource?.id ?? ""}
								onChange={(event) => void handleManualSelect(event.target.value)}
								className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 text-xs outline-none focus:border-white/40"
							>
								<option value="" disabled>
									{t("source.selectPlaceholder")}
								</option>
								{availableSources.map((source) => (
									<option key={source.id} value={source.id}>
										{source.name}
									</option>
								))}
							</select>
						</label>
						<div className="flex flex-col gap-1">
							<span className="text-xs text-white/60">{t("setup.returnFormatLabel")}</span>
							<div className="flex gap-2">
								<button
									type="button"
									onClick={() => updateSettings({ returnFormat: "kb" })}
									className={`flex-1 px-2 py-1.5 rounded-md border text-xs ${
										settings.returnFormat === "kb"
											? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
											: "border-white/15 hover:bg-white/10"
									}`}
								>
									{t("setup.returnKb")}
								</button>
								<button
									type="button"
									onClick={() => updateSettings({ returnFormat: "pdf" })}
									className={`flex-1 px-2 py-1.5 rounded-md border text-xs ${
										settings.returnFormat === "pdf"
											? "border-emerald-400/60 bg-emerald-500/15 text-emerald-200"
											: "border-white/15 hover:bg-white/10"
									}`}
								>
									{t("setup.returnPdf")}
								</button>
							</div>
						</div>
						<label className="flex flex-col gap-1">
							<span className="text-xs text-white/60">{t("setup.quality")}</span>
							<select
								value={settings.quality}
								onChange={(event) =>
									updateSettings({ quality: event.target.value as DocsieVideoToDocsQuality })
								}
								className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 outline-none focus:border-white/40"
							>
								<option value="draft">{t("setup.qualityDraft")}</option>
								<option value="standard">{t("setup.qualityStandard")}</option>
								<option value="detailed">{t("setup.qualityDetailed")}</option>
								<option value="ultra">{t("setup.qualityUltra")}</option>
							</select>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-xs text-white/60">{t("setup.language")}</span>
							<select
								value={settings.language}
								onChange={(event) =>
									updateSettings({
										language: event.target.value,
										languageManuallySet: true,
									})
								}
								className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 outline-none focus:border-white/40"
							>
								{LANGUAGE_OPTIONS.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
								{!LANGUAGE_OPTIONS.some((option) => option.value === settings.language) && (
									<option value={settings.language}>{settings.language}</option>
								)}
							</select>
							<span className="text-[10px] text-white/35">
								{t("setup.languageHint", {
									language: getDocumentLanguageForLocale(locale),
								})}
							</span>
						</label>
						<label className="flex flex-col gap-1">
							<span className="text-xs text-white/60">{t("setup.template")}</span>
							<select
								value={settings.generationTemplateId}
								onChange={(event) => updateSettings({ generationTemplateId: event.target.value })}
								disabled={!connected}
								className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 outline-none focus:border-white/40 disabled:opacity-50"
							>
								<option value="">{t("setup.templateNone")}</option>
								{templates.map((template) => (
									<option key={template.id} value={template.id}>
										{template.name}
										{template.category ? ` — ${template.category}` : ""}
									</option>
								))}
							</select>
							{!connected && (
								<span className="text-[10px] text-white/35">{t("setup.templateHint")}</span>
							)}
						</label>
						<label className="flex items-center gap-2 text-xs text-white/70">
							<input
								type="checkbox"
								checked={microphoneEnabled}
								onChange={(event) => setMicrophoneEnabled(event.target.checked)}
							/>
							{t("setup.microphone")}
						</label>
					</section>

					<button
						type="button"
						disabled={!connected}
						onClick={() => {
							updateSettings({ setupComplete: true });
							setShowSettings(false);
						}}
						className="py-3 rounded-lg bg-[#FF6738] text-white font-semibold text-sm hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
					>
						{connected ? t("setup.startCapturing") : t("setup.connectToContinue")}
					</button>
				</div>
			</CompanionShell>
		);
	}

	return (
		<CompanionShell>
			<div className="max-w-md mx-auto px-5 py-6 flex flex-col gap-4">
				<header className="flex items-center justify-between gap-2">
					<div className="flex items-center gap-2 min-w-0 text-xs">
						<span
							className={`w-2 h-2 rounded-full flex-none ${
								connected && attachedSource ? "bg-emerald-400" : "bg-amber-400"
							}`}
						/>
						<span className="truncate text-white/60">
							{connected
								? (docsieState?.organizationName ?? t("setup.connected"))
								: t("setup.notConnected")}
							{attachedSource ? ` · ${attachedSource.name}` : ` · ${t("main.noSource")}`}
						</span>
					</div>
					<div className="flex items-center gap-1.5 flex-none">
						<button
							type="button"
							onClick={() => void scanForSource()}
							title={t("main.rescanTitle")}
							className="text-[11px] px-2 py-1 rounded border border-white/15 hover:bg-white/10"
						>
							{t("main.rescan")}
						</button>
						<button
							type="button"
							onClick={() => setShowSettings(true)}
							title={t("main.setupTitle")}
							className="text-[11px] px-2 py-1 rounded border border-white/15 hover:bg-white/10"
						>
							{t("main.setup")}
						</button>
					</div>
				</header>

				<section className="rounded-lg border border-white/10 bg-white/5 p-4 flex flex-col gap-3">
					<label className="flex flex-col gap-1 text-sm">
						<span className="text-xs text-white/60">{t("session.label")}</span>
						<input
							value={sessionTitle}
							onChange={(event) => setSessionTitle(event.target.value)}
							placeholder={defaultSessionTitle(t)}
							disabled={recording || busyPublishing}
							className="bg-black/40 border border-white/15 rounded-md px-2.5 py-1.5 outline-none focus:border-white/40 disabled:opacity-50"
						/>
					</label>

					<div className="flex items-center gap-3">
						<button
							type="button"
							onClick={() => {
								if (publishPhase === "done" || publishPhase === "failed") {
									resetForNextSession();
								}
								toggleRecording();
							}}
							disabled={!canRecord && !recording}
							className={`flex-1 py-3 rounded-lg font-semibold text-sm transition-colors ${
								recording
									? "bg-red-600 hover:bg-red-500 text-white"
									: "bg-[#FF6738] hover:opacity-90 text-white disabled:opacity-40 disabled:cursor-not-allowed"
							}`}
						>
							{recording
								? t("record.stopWithTime", { time: formatElapsed(elapsedSeconds) })
								: t("record.record")}
						</button>
						{recording && (
							<button
								type="button"
								onClick={cancelRecording}
								className="px-3 py-3 rounded-lg border border-white/15 text-xs hover:bg-white/10"
							>
								{t("record.cancel")}
							</button>
						)}
					</div>

					{!connected && <p className="text-[11px] text-white/45">{t("main.connectFirst")}</p>}
					{connected && !attachedSource && (
						<p className="text-[11px] text-white/45">{t("main.pickSource")}</p>
					)}
				</section>

				{publishPhase !== "idle" && (
					<section className="rounded-lg border border-white/10 bg-white/5 p-4 flex flex-col gap-3 text-sm">
						<div className="flex items-center gap-2">
							{progressSteps.map((step) => {
								const stepIndex = phaseOrder.indexOf(step.key);
								const stepState =
									publishPhase === "failed"
										? phaseIndex > stepIndex
											? "done"
											: "failed"
										: publishPhase === "done" || phaseIndex > stepIndex
											? "done"
											: phaseIndex === stepIndex
												? "active"
												: "pending";
								return (
									<div key={step.key} className="flex-1 flex flex-col items-center gap-1">
										<div
											className={`w-2.5 h-2.5 rounded-full ${
												stepState === "done"
													? "bg-emerald-400"
													: stepState === "active"
														? "bg-[#FF6738] animate-pulse"
														: stepState === "failed"
															? "bg-red-500"
															: "bg-white/20"
											}`}
										/>
										<span className="text-[10px] text-white/55">{step.label}</span>
									</div>
								);
							})}
						</div>

						<p
							className={`text-xs ${publishPhase === "failed" ? "text-red-300" : "text-white/70"}`}
						>
							{statusText}
						</p>

						{publishPhase === "done" && publishResult && (
							<div className="flex flex-col gap-2">
								{publishResult.kbUrl && (
									<button
										type="button"
										onClick={() =>
											void window.electronAPI.openExternalUrl(publishResult.kbUrl ?? "")
										}
										className="py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
									>
										{t("result.openKb")}
									</button>
								)}
								{publishResult.pdfUrl && (
									<button
										type="button"
										onClick={() =>
											void window.electronAPI.openExternalUrl(publishResult.pdfUrl ?? "")
										}
										className="py-2 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
									>
										{t("result.downloadPdf")}
									</button>
								)}
								<button
									type="button"
									onClick={resetForNextSession}
									className="py-2 rounded-md border border-white/15 text-xs hover:bg-white/10"
								>
									{t("result.recordAnother")}
								</button>
							</div>
						)}

						{publishPhase === "failed" && (
							<button
								type="button"
								onClick={resetForNextSession}
								className="py-2 rounded-md border border-white/15 text-xs hover:bg-white/10"
							>
								{t("result.dismiss")}
							</button>
						)}
					</section>
				)}
			</div>
		</CompanionShell>
	);
}
