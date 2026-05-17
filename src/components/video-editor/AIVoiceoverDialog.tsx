import { Loader2, RefreshCcw, Settings2, Volume2 } from "lucide-react";
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
	DocsieIntegrationState,
	DocsieTranscriptionOptionsResult,
	DocsieVoiceDefaultOptions,
	DocsieVoiceOptionsResult,
} from "@/lib/docsieIntegration";
import { normalizeTranscriptSegments } from "./audioProcessing";
import type { VoiceoverState } from "./types";

interface AIVoiceoverDialogProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	videoPath: string | null;
	videoUrl: string | null;
	voiceover: VoiceoverState;
	onVoiceoverChange: (voiceover: VoiceoverState) => void;
	onOpenAISettings: () => void;
}

const VOICEOVER_TEXT_MAX_LENGTH = 4000;
const TRANSCRIPTION_AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"];

function getDefaultVoiceOptionString(
	options: DocsieVoiceDefaultOptions | undefined,
	key: keyof DocsieVoiceDefaultOptions,
) {
	const value = options?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : "";
}

function getDefaultVoiceSpeed(options: DocsieVoiceDefaultOptions | undefined) {
	return typeof options?.speed === "number" && Number.isFinite(options.speed)
		? String(options.speed)
		: "1";
}

function normalizeVoiceoverFilename(videoPath: string | null) {
	const base =
		videoPath
			?.split(/[\\/]/)
			.pop()
			?.replace(/\.[^.]+$/, "") || "screen-recorder";
	return `${base.replace(/[^a-zA-Z0-9._-]+/g, "-") || "screen-recorder"}-voiceover`;
}

function normalizeTranscriptionAudioFilename(videoPath: string | null) {
	return `${normalizeVoiceoverFilename(videoPath).replace(/-voiceover$/, "")}-transcription.webm`;
}

function getSupportedTranscriptionAudioMimeType() {
	return TRANSCRIPTION_AUDIO_MIME_TYPES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
}

function waitForMediaMetadata(media: HTMLMediaElement) {
	if (Number.isFinite(media.duration) && media.readyState >= HTMLMediaElement.HAVE_METADATA) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		const onLoaded = () => {
			cleanup();
			resolve();
		};
		const onError = () => {
			cleanup();
			reject(new Error("Failed to load video for transcription"));
		};
		const cleanup = () => {
			media.removeEventListener("loadedmetadata", onLoaded);
			media.removeEventListener("error", onError);
		};

		media.addEventListener("loadedmetadata", onLoaded);
		media.addEventListener("error", onError, { once: true });
	});
}

async function extractAudioForTranscription(videoUrl: string) {
	const media = document.createElement("video");
	media.src = videoUrl;
	media.preload = "auto";
	media.playsInline = true;

	await waitForMediaMetadata(media);

	const audioContext = new AudioContext();
	const sourceNode = audioContext.createMediaElementSource(media);
	const destinationNode = audioContext.createMediaStreamDestination();
	sourceNode.connect(destinationNode);

	const mimeType = getSupportedTranscriptionAudioMimeType();
	const recorder = new MediaRecorder(destinationNode.stream, {
		audioBitsPerSecond: 128_000,
		...(mimeType ? { mimeType } : {}),
	});
	const chunks: Blob[] = [];

	const recordedBlobPromise = new Promise<Blob>((resolve, reject) => {
		recorder.ondataavailable = (event: BlobEvent) => {
			if (event.data && event.data.size > 0) {
				chunks.push(event.data);
			}
		};
		recorder.onerror = () => {
			reject(new Error("Failed while extracting recording audio"));
		};
		recorder.onstop = () => {
			resolve(new Blob(chunks, { type: mimeType || chunks[0]?.type || "audio/webm" }));
		};
	});

	let playbackError: unknown;
	try {
		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		recorder.start();
		await media.play();
		await new Promise<void>((resolve, reject) => {
			const onEnded = () => {
				cleanup();
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new Error("Failed while playing recording audio"));
			};
			const cleanup = () => {
				media.removeEventListener("ended", onEnded);
				media.removeEventListener("error", onError);
			};

			media.addEventListener("ended", onEnded, { once: true });
			media.addEventListener("error", onError, { once: true });
		});
	} catch (error) {
		playbackError = error;
	} finally {
		media.pause();
		if (recorder.state !== "inactive") {
			recorder.stop();
		}
		destinationNode.stream.getTracks().forEach((track) => track.stop());
		sourceNode.disconnect();
		destinationNode.disconnect();
		await audioContext.close();
		media.src = "";
		media.load();
	}

	const blob = await recordedBlobPromise;
	if (playbackError) {
		throw playbackError;
	}
	if (blob.size === 0) {
		throw new Error("No audio could be extracted from this recording");
	}

	return {
		audioData: await blob.arrayBuffer(),
		contentType: blob.type || "audio/webm",
	};
}

export function AIVoiceoverDialog({
	isOpen,
	onOpenChange,
	videoPath,
	videoUrl,
	voiceover,
	onVoiceoverChange,
	onOpenAISettings,
}: AIVoiceoverDialogProps) {
	const [state, setState] = useState<DocsieIntegrationState | null>(null);
	const [voiceOptions, setVoiceOptions] = useState<DocsieVoiceOptionsResult | null>(null);
	const [transcriptionOptions, setTranscriptionOptions] =
		useState<DocsieTranscriptionOptionsResult | null>(null);
	const [script, setScript] = useState(voiceover.script);
	const [selectedVoiceProvider, setSelectedVoiceProvider] = useState("");
	const [selectedVoiceId, setSelectedVoiceId] = useState(voiceover.voiceId ?? "");
	const [voiceSpeed, setVoiceSpeed] = useState(String(voiceover.speed || 1));
	const [transcriptionLanguage, setTranscriptionLanguage] = useState("auto");
	const [loading, setLoading] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const [generating, setGenerating] = useState(false);

	const configuredVoiceProviders = useMemo(
		() => voiceOptions?.providers.filter((provider) => provider.configured) ?? [],
		[voiceOptions],
	);
	const selectedVoiceProviderOptions = useMemo(
		() =>
			configuredVoiceProviders.find((provider) => provider.provider === selectedVoiceProvider) ??
			null,
		[configuredVoiceProviders, selectedVoiceProvider],
	);

	const loadAIState = useCallback(async () => {
		setLoading(true);
		try {
			const result = await window.electronAPI.docsieGetState();
			const nextState = result.success ? (result.state ?? null) : null;
			setState(nextState);

			if (nextState?.hasToken) {
				const [voices, transcription] = await Promise.all([
					window.electronAPI.docsieListVoiceOptions(),
					window.electronAPI.docsieListTranscriptionOptions(),
				]);
				setVoiceOptions(voices);
				setTranscriptionOptions(transcription);
				if (voices.success) {
					const defaults = voices.defaultVoiceOptions ?? nextState.defaultVoiceOptions;
					setSelectedVoiceId(
						(current) => current || getDefaultVoiceOptionString(defaults, "voice_id"),
					);
					setVoiceSpeed((current) => current || getDefaultVoiceSpeed(defaults));
				}
			} else {
				setVoiceOptions(null);
				setTranscriptionOptions(null);
			}
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		setScript(voiceover.script);
		setSelectedVoiceId(voiceover.voiceId ?? "");
		setVoiceSpeed(String(voiceover.speed || 1));
		void loadAIState();
	}, [isOpen, loadAIState, voiceover.script, voiceover.speed, voiceover.voiceId]);

	const handleTranscribe = useCallback(async () => {
		if (!videoUrl) {
			toast.error("No video loaded");
			return;
		}
		const transcriptionAvailable = Boolean(
			state?.transcriptionApiEnabled || transcriptionOptions?.success,
		);
		if (!state?.hasToken || !transcriptionAvailable) {
			toast.error("Connect transcription in AI Settings first");
			return;
		}

		setTranscribing(true);
		try {
			const extracted = await extractAudioForTranscription(videoUrl);
			const result = await window.electronAPI.docsieTranscribeAudio({
				audioData: extracted.audioData,
				contentType: extracted.contentType,
				fileName: normalizeTranscriptionAudioFilename(videoPath),
				language: transcriptionLanguage.trim() || "auto",
			});

			if (!result.success || !result.text?.trim()) {
				throw new Error(result.error ?? "Transcription did not return text");
			}

			const transcript = result.text.trim();
			const scriptDraft = transcript.slice(0, VOICEOVER_TEXT_MAX_LENGTH);
			setScript(scriptDraft);
			onVoiceoverChange({
				...voiceover,
				script: scriptDraft,
				transcriptSegments: normalizeTranscriptSegments(result),
				transcriptionDurationSeconds: result.durationSeconds,
			});
			if (scriptDraft.length < transcript.length) {
				toast.info("Transcript was shortened to fit the voiceover script limit");
			} else {
				const creditSummary =
					typeof result.creditsCharged === "number"
						? ` · ${result.creditsCharged.toLocaleString()} credits`
						: "";
				toast.success(`Transcript ready${creditSummary}`);
			}
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Transcription failed");
		} finally {
			setTranscribing(false);
		}
	}, [
		state?.hasToken,
		state?.transcriptionApiEnabled,
		transcriptionLanguage,
		transcriptionOptions?.success,
		videoPath,
		videoUrl,
		voiceover,
		onVoiceoverChange,
	]);

	const handleGenerate = useCallback(async () => {
		const normalizedScript = script.trim();
		if (!normalizedScript) {
			toast.error("Write the voiceover script before generating audio");
			return;
		}
		const voiceAvailable = Boolean(state?.voiceApiEnabled || voiceOptions?.success);
		if (!state?.hasToken || !voiceAvailable) {
			toast.error("Connect voice generation in AI Settings first");
			return;
		}

		const speed = Number.parseFloat(voiceSpeed);
		setGenerating(true);
		try {
			const result = await window.electronAPI.docsieGenerateVoiceover({
				text: normalizedScript,
				provider: selectedVoiceProvider || undefined,
				voiceId: selectedVoiceProvider ? selectedVoiceId || undefined : undefined,
				speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
				filename: normalizeVoiceoverFilename(videoPath),
			});

			if (!result.success || !result.audioFilePath) {
				throw new Error(result.error ?? "Voice generation failed");
			}

			onVoiceoverChange({
				enabled: true,
				script: normalizedScript,
				audioFilePath: result.audioFilePath,
				audioFileUrl: result.audioFileUrl,
				provider: result.provider,
				model: result.model,
				voiceName: result.voiceName,
				voiceId: selectedVoiceId || undefined,
				speed: Number.isFinite(speed) && speed > 0 ? speed : 1,
				contentType: result.contentType,
				filename: result.filename,
				source: result.source,
				generatedAt: new Date().toISOString(),
				exportMode: "replace",
			});
			toast.success("AI voiceover generated");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Voice generation failed");
		} finally {
			setGenerating(false);
		}
	}, [
		onVoiceoverChange,
		script,
		selectedVoiceId,
		selectedVoiceProvider,
		state?.hasToken,
		state?.voiceApiEnabled,
		videoPath,
		voiceOptions?.success,
		voiceSpeed,
	]);

	const handleReveal = useCallback(async () => {
		if (!voiceover.audioFilePath) {
			return;
		}
		const result = await window.electronAPI.revealInFolder(voiceover.audioFilePath);
		if (!result.success) {
			toast.error(result.error ?? "Failed to reveal voiceover audio");
		}
	}, [voiceover.audioFilePath]);

	const preferredVoiceLabel = voiceOptions?.preferredProvider
		? `Auto (${voiceOptions.preferredProvider})`
		: "Auto";
	const voiceAvailable = Boolean(state?.voiceApiEnabled || voiceOptions?.success);
	const transcriptionAvailable = Boolean(
		state?.transcriptionApiEnabled || transcriptionOptions?.success,
	);
	const canTranscribe = Boolean(state?.hasToken && transcriptionAvailable && videoUrl);
	const canGenerate = Boolean(state?.hasToken && voiceAvailable && voiceOptions?.success);
	const connectionWarning = !state?.hasToken
		? {
				title: "Docsie AI is not connected",
				detail:
					"Open AI Settings to connect Docsie, then discover transcription and voice support.",
			}
		: !voiceAvailable && !transcriptionAvailable
			? {
					title: "AI services are not available",
					detail: "Refresh AI Settings to discover transcription and voice generation support.",
				}
			: null;

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-hidden border border-[rgba(254,168,94,0.18)] bg-[#17110f] text-[#fff0e4] sm:max-w-[760px]">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-[#fff0e4]">
						<Volume2 className="h-5 w-5 text-[#FEA85E]" />
						Transcribe & Voiceover
					</DialogTitle>
					<DialogDescription className="text-[#8f7e73]">
						Transcribe the current recording, edit the narration script, then generate AI voiceover
						audio.
					</DialogDescription>
				</DialogHeader>

				<div className="grid max-h-[calc(90vh-10rem)] gap-4 overflow-y-auto pr-1">
					{connectionWarning ? (
						<div className="rounded-2xl border border-[rgba(255,103,56,0.22)] bg-[rgba(255,103,56,0.08)] p-4">
							<div className="text-sm font-semibold text-[#fff0e4]">{connectionWarning.title}</div>
							<div className="mt-1 text-sm text-[#c6b4a8]">{connectionWarning.detail}</div>
							<Button
								type="button"
								onClick={onOpenAISettings}
								className="mt-3 bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
							>
								<Settings2 className="mr-2 h-4 w-4" />
								Open AI Settings
							</Button>
						</div>
					) : null}

					<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
						<div className="mb-3 flex items-start justify-between gap-3">
							<div>
								<div className="text-sm font-semibold text-[#fff0e4]">Narration Script</div>
								<div className="text-xs text-[#8f7e73]">
									Transcribe the recording audio, edit the script, then generate narration.
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<Input
									value={transcriptionLanguage}
									onChange={(event) => setTranscriptionLanguage(event.target.value)}
									placeholder="auto"
									className="h-9 w-24 border-white/10 bg-[#17110f] text-xs text-[#fff0e4]"
								/>
								<Button
									type="button"
									variant="secondary"
									onClick={() => void handleTranscribe()}
									disabled={transcribing || !canTranscribe}
									className="bg-white/10 text-[#fff0e4] hover:bg-white/15 disabled:text-[#8f7e73]"
								>
									{transcribing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
									Transcribe Video
								</Button>
							</div>
						</div>
						<textarea
							value={script}
							onChange={(event) => setScript(event.target.value)}
							rows={8}
							maxLength={VOICEOVER_TEXT_MAX_LENGTH}
							className="min-h-44 w-full resize-y rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm leading-5 text-[#fff0e4] outline-none placeholder:text-[#8f7e73]"
							placeholder="Type the narration you want the AI voice to speak."
						/>
						<div className="mt-2 flex items-center justify-between text-xs text-[#8f7e73]">
							<span>
								{state?.hasToken && !transcriptionAvailable
									? "Transcription is not available for this Docsie connection."
									: "Export will replace the original recording audio when voiceover is enabled."}
							</span>
							<span>
								{script.length.toLocaleString()} / {VOICEOVER_TEXT_MAX_LENGTH.toLocaleString()}
							</span>
						</div>
					</div>

					<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
						<div className="mb-3 flex items-center justify-between gap-3">
							<div className="text-sm font-semibold text-[#fff0e4]">Voice</div>
							<Button
								type="button"
								variant="secondary"
								onClick={() => void loadAIState()}
								disabled={loading}
								className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
							>
								{loading ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<RefreshCcw className="mr-2 h-4 w-4" />
								)}
								Refresh
							</Button>
						</div>
						<div className="grid gap-3 md:grid-cols-[1fr_1fr_96px]">
							<div className="space-y-1.5">
								<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
									Provider
								</label>
								<select
									value={selectedVoiceProvider}
									onChange={(event) => {
										const provider = event.target.value;
										setSelectedVoiceProvider(provider);
										const nextProvider = configuredVoiceProviders.find(
											(candidate) => candidate.provider === provider,
										);
										setSelectedVoiceId(nextProvider?.voices[0]?.id ?? "");
									}}
									disabled={!canGenerate}
									className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none disabled:opacity-60"
								>
									<option value="">{preferredVoiceLabel}</option>
									{configuredVoiceProviders.map((provider) => (
										<option key={provider.provider} value={provider.provider}>
											{provider.provider}
										</option>
									))}
								</select>
							</div>
							<div className="space-y-1.5">
								<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
									Voice
								</label>
								<select
									value={selectedVoiceProvider ? selectedVoiceId : ""}
									onChange={(event) => setSelectedVoiceId(event.target.value)}
									disabled={!canGenerate || !selectedVoiceProvider}
									className="flex h-10 w-full rounded-md border border-white/10 bg-[#17110f] px-3 py-2 text-sm text-[#fff0e4] outline-none disabled:opacity-60"
								>
									<option value="">
										{selectedVoiceProvider ? "Default voice" : "Docsie default voice"}
									</option>
									{selectedVoiceProviderOptions?.voices.map((voice) => (
										<option key={voice.id} value={voice.id}>
											{voice.name}
											{voice.tier ? ` · ${voice.tier}` : ""}
										</option>
									))}
								</select>
							</div>
							<div className="space-y-1.5">
								<label className="text-xs font-medium uppercase tracking-[0.16em] text-[#c6b4a8]">
									Speed
								</label>
								<Input
									type="number"
									min="0.5"
									max="2"
									step="0.05"
									value={voiceSpeed}
									onChange={(event) => setVoiceSpeed(event.target.value)}
									className="border-white/10 bg-[#17110f] text-[#fff0e4]"
								/>
							</div>
						</div>

						<div className="mt-4 flex flex-wrap items-center gap-2">
							<Button
								type="button"
								onClick={() => void handleGenerate()}
								disabled={generating || !canGenerate || !script.trim()}
								className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
							>
								{generating ? (
									<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								) : (
									<Volume2 className="mr-2 h-4 w-4" />
								)}
								Generate Voiceover
							</Button>
							{voiceover.audioFilePath ? (
								<Button
									type="button"
									variant="secondary"
									onClick={() =>
										onVoiceoverChange({
											...voiceover,
											script,
											enabled: !voiceover.enabled,
											exportMode: "replace",
										})
									}
									className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
								>
									{voiceover.enabled ? "Disable In Export" : "Use In Export"}
								</Button>
							) : null}
							{voiceover.audioFilePath ? (
								<Button
									type="button"
									variant="secondary"
									onClick={() => void handleReveal()}
									className="bg-white/10 text-[#fff0e4] hover:bg-white/15"
								>
									Show Audio
								</Button>
							) : null}
						</div>
					</div>

					{voiceover.audioFileUrl ? (
						<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
							<div className="mb-2 text-sm font-semibold text-[#fff0e4]">Generated Audio</div>
							<audio controls src={voiceover.audioFileUrl} className="w-full" />
							<div className="mt-2 text-xs text-[#8f7e73]">
								{[
									voiceover.enabled ? "Enabled for export" : "Preview only",
									voiceover.voiceName,
									voiceover.provider,
									voiceover.model,
									voiceover.filename,
								]
									.filter(Boolean)
									.join(" • ")}
							</div>
						</div>
					) : null}
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
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
