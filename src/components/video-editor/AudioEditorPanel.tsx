import { Captions, CheckCircle2, FileAudio, Loader2, Mic2, Scissors, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	buildWaveformPeaksFromArrayBuffer,
	buildWaveformPeaksFromMediaUrl,
	extractAudioForTranscription,
	normalizeTranscriptionAudioFilename,
	normalizeTranscriptSegments,
	normalizeVoiceoverFilename,
} from "./audioProcessing";
import type { TrimRegion, VoiceoverState, VoiceoverTranscriptSegment } from "./types";

interface AudioEditorPanelProps {
	videoDuration: number;
	currentTime: number;
	videoPath: string | null;
	videoUrl: string | null;
	audioPath?: string | null;
	trimRegions: TrimRegion[];
	voiceover: VoiceoverState;
	onVoiceoverChange: (voiceover: VoiceoverState) => void;
	onCutAtPlayhead: () => void;
}

const WAVEFORM_SAMPLES = 240;
const VOICEOVER_TEXT_MAX_LENGTH = 4000;

type AudioOperationPhase = "idle" | "checking" | "extracting" | "uploading" | "generating" | "done";

function formatAudioTime(seconds: number) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return "0:00";
	}

	const totalSeconds = Math.floor(seconds);
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getOperationLabel(phase: AudioOperationPhase, progress: number | null) {
	switch (phase) {
		case "checking":
			return "Checking Docsie AI connection";
		case "extracting":
			return progress === null
				? "Preparing recording audio"
				: `Extracting recording audio ${Math.round(progress)}%`;
		case "uploading":
			return "Sending audio to transcription";
		case "generating":
			return "Generating AI voice";
		case "done":
			return "Voice transcript ready";
		default:
			return "";
	}
}

function WaveformBars({ peaks, muted = false }: { peaks: number[] | null; muted?: boolean }) {
	if (!peaks?.length) {
		return (
			<div className="flex h-full items-center gap-px px-3">
				{Array.from({ length: 96 }).map((_, index) => (
					<div
						key={index}
						className="w-1 flex-1 rounded-full bg-white/10"
						style={{ height: `${12 + ((index * 17) % 30)}%` }}
					/>
				))}
			</div>
		);
	}

	return (
		<div className="flex h-full items-center gap-px px-3">
			{peaks.map((peak, index) => (
				<div
					key={index}
					className={`w-1 flex-1 rounded-full ${
						muted
							? "bg-white/15"
							: "bg-[linear-gradient(180deg,rgba(254,168,94,0.95),rgba(255,103,56,0.72))]"
					}`}
					style={{ height: `${Math.max(8, peak * 100)}%` }}
				/>
			))}
		</div>
	);
}

function TranscriptOverlay({
	segments,
	durationSeconds,
	currentTime,
}: {
	segments: VoiceoverTranscriptSegment[];
	durationSeconds: number;
	currentTime: number;
}) {
	if (!segments.length || durationSeconds <= 0) {
		return null;
	}

	const durationMs = durationSeconds * 1000;
	const currentMs = currentTime * 1000;
	const activeSegment = segments.find(
		(segment) => currentMs >= segment.startMs && currentMs <= segment.endMs,
	);

	return (
		<div className="mt-2">
			<div className="relative h-7 overflow-hidden rounded-lg border border-white/10 bg-[#17110f]">
				{segments.map((segment, index) => {
					const left = Math.max(0, Math.min(100, (segment.startMs / durationMs) * 100));
					const width = Math.max(
						1.5,
						Math.min(100 - left, ((segment.endMs - segment.startMs) / durationMs) * 100),
					);
					const active = currentMs >= segment.startMs && currentMs <= segment.endMs;
					return (
						<div
							key={index}
							className={`absolute top-1 h-5 overflow-hidden rounded px-1 text-[10px] leading-5 ${
								active ? "bg-[#FF6738] text-white" : "bg-white/8 text-[#8f7e73]"
							}`}
							style={{ left: `${left}%`, width: `${width}%` }}
							title={segment.text}
						>
							{segment.text}
						</div>
					);
				})}
			</div>
			<div className="mt-1 min-h-5 truncate text-xs text-[#FEA85E]">
				{activeSegment?.text ?? "Transcript timing is ready"}
			</div>
		</div>
	);
}

function AudioTrack({
	label,
	detail,
	peaks,
	playheadPercent,
	videoDuration,
	trimRegions = [],
	tone,
}: {
	label: string;
	detail: string;
	peaks: number[] | null;
	playheadPercent: number;
	videoDuration: number;
	trimRegions?: TrimRegion[];
	tone: "source" | "voiceover";
}) {
	const muted = tone === "voiceover" && !peaks?.length;
	return (
		<div className="grid grid-cols-[140px_1fr] items-center gap-3">
			<div>
				<div className="text-xs font-semibold text-[#fff0e4]">{label}</div>
				<div className="mt-0.5 text-[10px] text-[#8f7e73]">{detail}</div>
			</div>
			<div
				className={`relative h-16 overflow-hidden rounded-xl border ${
					tone === "source"
						? "border-[#FEA85E]/30 bg-[#241917]"
						: peaks?.length
							? "border-[#FF6738]/35 bg-[#2a1712]"
							: "border-white/10 bg-white/[0.03]"
				}`}
			>
				<WaveformBars peaks={peaks} muted={muted} />
				{videoDuration > 0
					? trimRegions.map((trim) => {
							const left = Math.max(
								0,
								Math.min(100, (trim.startMs / (videoDuration * 1000)) * 100),
							);
							const width = Math.max(
								0.5,
								Math.min(100 - left, ((trim.endMs - trim.startMs) / (videoDuration * 1000)) * 100),
							);
							return (
								<div
									key={trim.id}
									className="absolute inset-y-1 rounded bg-[#ef4444]/28 ring-1 ring-[#ef4444]/45"
									style={{ left: `${left}%`, width: `${width}%` }}
								/>
							);
						})
					: null}
				<div
					className="absolute bottom-1 top-1 z-10 w-px bg-[#FF6738] shadow-[0_0_12px_rgba(255,103,56,0.75)]"
					style={{ left: `${playheadPercent}%` }}
				/>
			</div>
		</div>
	);
}

export function AudioEditorPanel({
	videoDuration,
	currentTime,
	videoPath,
	videoUrl,
	audioPath,
	trimRegions,
	voiceover,
	onVoiceoverChange,
	onCutAtPlayhead,
}: AudioEditorPanelProps) {
	const [sourcePeaks, setSourcePeaks] = useState<number[] | null>(null);
	const [voicePeaks, setVoicePeaks] = useState<number[] | null>(null);
	const [loadingWaveform, setLoadingWaveform] = useState(false);
	const [transcribing, setTranscribing] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [operationPhase, setOperationPhase] = useState<AudioOperationPhase>("idle");
	const [operationDetail, setOperationDetail] = useState("");
	const [operationProgress, setOperationProgress] = useState<number | null>(null);
	const [operationError, setOperationError] = useState<string | null>(null);
	const transcript = voiceover.script.trim();
	const transcriptSegments = voiceover.transcriptSegments ?? [];
	const playheadPercent =
		videoDuration > 0
			? Math.max(0, Math.min(100, (Math.max(0, currentTime) / videoDuration) * 100))
			: 0;

	useEffect(() => {
		if (!videoUrl) {
			setSourcePeaks(null);
			return;
		}

		let cancelled = false;
		setLoadingWaveform(true);
		buildWaveformPeaksFromMediaUrl(videoUrl, WAVEFORM_SAMPLES)
			.then((peaks) => {
				if (!cancelled) {
					setSourcePeaks(peaks);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setSourcePeaks(null);
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoadingWaveform(false);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [videoUrl]);

	useEffect(() => {
		if (!voiceover.audioFileUrl) {
			setVoicePeaks(null);
			return;
		}

		let cancelled = false;
		buildWaveformPeaksFromMediaUrl(voiceover.audioFileUrl, WAVEFORM_SAMPLES)
			.then((peaks) => {
				if (!cancelled) {
					setVoicePeaks(peaks);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setVoicePeaks(null);
				}
			});

		return () => {
			cancelled = true;
		};
	}, [voiceover.audioFileUrl]);

	const activeTranscript = useMemo(() => {
		const currentMs = currentTime * 1000;
		return transcriptSegments.find(
			(segment) => currentMs >= segment.startMs && currentMs <= segment.endMs,
		);
	}, [currentTime, transcriptSegments]);
	const operationLabel = getOperationLabel(operationPhase, operationProgress);

	const runTranscription = useCallback(async () => {
		if (!audioPath && !videoUrl) {
			throw new Error("No video loaded");
		}

		setOperationError(null);
		setOperationProgress(null);
		setOperationPhase("checking");
		setOperationDetail("Verifying transcription support.");
		const stateResult = await window.electronAPI.docsieGetState();
		if (!stateResult.success || !stateResult.state?.hasToken) {
			throw new Error("Connect Docsie AI first");
		}

		const transcriptionOptions = await window.electronAPI.docsieListTranscriptionOptions();
		if (!transcriptionOptions.success) {
			throw new Error(transcriptionOptions.error ?? "Transcription is not available");
		}

		if (audioPath) {
			setOperationPhase("uploading");
			setOperationProgress(null);
			setOperationDetail("Uploading recorded audio to Docsie transcription.");
			const result = await window.electronAPI.docsieTranscribeAudio({
				audioPath,
				contentType: "audio/webm",
				fileName: normalizeTranscriptionAudioFilename(videoPath),
				language: "auto",
			});
			if (!result.success || !result.text?.trim()) {
				throw new Error(result.error ?? "Transcription did not return text");
			}
			const nextScript = result.text.trim().slice(0, VOICEOVER_TEXT_MAX_LENGTH);
			const nextVoiceover: VoiceoverState = {
				...voiceover,
				script: nextScript,
				transcriptSegments: normalizeTranscriptSegments(result),
				transcriptionDurationSeconds: result.durationSeconds,
			};
			onVoiceoverChange(nextVoiceover);
			setOperationPhase("done");
			setOperationDetail("Transcript loaded from the recorded audio track.");
			toast.success("Transcript ready");
			return nextVoiceover;
		}

		setOperationPhase("extracting");
		setOperationDetail(
			videoDuration > 0
				? `Extracting audio locally. This can take about ${formatAudioTime(videoDuration)}.`
				: "Extracting audio locally before upload.",
		);
		const extracted = await extractAudioForTranscription(videoUrl as string, {
			onProgress: (progress) => {
				setOperationProgress(progress.percentage);
				setOperationDetail(
					`${formatAudioTime(progress.currentSeconds)} / ${formatAudioTime(progress.durationSeconds)} extracted`,
				);
			},
		});
		buildWaveformPeaksFromArrayBuffer(extracted.audioData, WAVEFORM_SAMPLES)
			.then(setSourcePeaks)
			.catch(() => undefined);

		setOperationPhase("uploading");
		setOperationProgress(null);
		setOperationDetail("Uploading audio to Docsie transcription.");
		const result = await window.electronAPI.docsieTranscribeAudio({
			audioData: extracted.audioData,
			contentType: extracted.contentType,
			fileName: normalizeTranscriptionAudioFilename(videoPath),
			language: "auto",
		});

		if (!result.success || !result.text?.trim()) {
			throw new Error(result.error ?? "Transcription did not return text");
		}

		const nextScript = result.text.trim().slice(0, VOICEOVER_TEXT_MAX_LENGTH);
		const nextVoiceover: VoiceoverState = {
			...voiceover,
			script: nextScript,
			transcriptSegments: normalizeTranscriptSegments(result),
			transcriptionDurationSeconds: result.durationSeconds,
		};
		onVoiceoverChange(nextVoiceover);
		setOperationPhase("done");
		setOperationDetail(
			nextVoiceover.transcriptSegments?.length
				? `${nextVoiceover.transcriptSegments.length.toLocaleString()} timed transcript segments returned.`
				: "Transcript text returned.",
		);
		return nextVoiceover;
	}, [audioPath, onVoiceoverChange, videoDuration, videoPath, videoUrl, voiceover]);

	const handleTranscribe = useCallback(async () => {
		setTranscribing(true);
		try {
			const nextVoiceover = await runTranscription();
			const creditSummary = nextVoiceover.transcriptSegments?.length
				? ` · ${nextVoiceover.transcriptSegments.length.toLocaleString()} timed segments`
				: "";
			toast.success(`Transcript ready${creditSummary}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Transcription failed";
			setOperationPhase("idle");
			setOperationProgress(null);
			setOperationError(message);
			toast.error(message);
		} finally {
			setTranscribing(false);
		}
	}, [runTranscription]);

	const handleGenerateAI = useCallback(async () => {
		setGenerating(true);
		try {
			let nextVoiceover = voiceover;
			if (!nextVoiceover.script.trim()) {
				nextVoiceover = await runTranscription();
			}

			const stateResult = await window.electronAPI.docsieGetState();
			if (!stateResult.success || !stateResult.state?.hasToken) {
				throw new Error("Connect Docsie AI first");
			}

			const voiceOptions = await window.electronAPI.docsieListVoiceOptions();
			if (!voiceOptions.success) {
				throw new Error(voiceOptions.error ?? "Voice generation is not available");
			}

			setOperationError(null);
			setOperationPhase("generating");
			setOperationProgress(null);
			setOperationDetail("Sending transcript to Docsie voice generation.");
			const result = await window.electronAPI.docsieGenerateVoiceover({
				text: nextVoiceover.script.trim(),
				filename: normalizeVoiceoverFilename(videoPath),
			});

			if (!result.success || !result.audioFilePath) {
				throw new Error(result.error ?? "AI voice generation failed");
			}

			onVoiceoverChange({
				...nextVoiceover,
				enabled: true,
				audioFilePath: result.audioFilePath,
				audioFileUrl: result.audioFileUrl,
				provider: result.provider,
				model: result.model,
				voiceName: result.voiceName,
				contentType: result.contentType,
				filename: result.filename,
				source: result.source,
				generatedAt: new Date().toISOString(),
				exportMode: "replace",
			});
			setOperationPhase("done");
			setOperationDetail("AI voice track generated and enabled for export.");
			toast.success("AI voice track ready");
		} catch (error) {
			const message = error instanceof Error ? error.message : "AI voice generation failed";
			setOperationPhase("idle");
			setOperationProgress(null);
			setOperationError(message);
			toast.error(message);
		} finally {
			setGenerating(false);
		}
	}, [onVoiceoverChange, runTranscription, videoPath, voiceover]);

	return (
		<div className="flex h-full min-h-0 flex-col bg-[#17110f]">
			<div className="flex items-center justify-between gap-3 border-b border-white/5 px-4 py-2">
				<div className="flex items-center gap-2 text-sm font-semibold text-[#fff0e4]">
					<FileAudio className="h-4 w-4 text-[#FEA85E]" />
					Voice Editing
					{loadingWaveform ? (
						<span className="text-[10px] font-medium text-[#8f7e73]">loading waveform</span>
					) : null}
				</div>
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={onCutAtPlayhead}
						className="h-8 bg-white/10 text-xs text-[#fff0e4] hover:bg-white/15"
					>
						<Scissors className="mr-1.5 h-3.5 w-3.5" />
						Cut
					</Button>
					<Button
						type="button"
						variant="secondary"
						size="sm"
						onClick={() => void handleTranscribe()}
						disabled={transcribing || generating || !videoUrl}
						className="h-8 bg-white/10 text-xs text-[#fff0e4] hover:bg-white/15"
					>
						{transcribing ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : (
							<Captions className="mr-1.5 h-3.5 w-3.5" />
						)}
						{transcribing ? "Working" : "Transcribe"}
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={() => void handleGenerateAI()}
						disabled={generating || transcribing || !videoUrl}
						className="h-8 bg-[#FF6738] text-xs text-white hover:bg-[#FF6738]/90"
					>
						{generating ? (
							<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
						) : (
							<Mic2 className="mr-1.5 h-3.5 w-3.5" />
						)}
						{generating ? "Working" : "AI Voice"}
					</Button>
				</div>
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto p-4">
				{operationLabel || operationError ? (
					<div
						className={`mb-3 rounded-xl border p-3 ${
							operationError
								? "border-[#ef4444]/35 bg-[#ef4444]/10 text-[#ffd1d1]"
								: "border-[#FEA85E]/25 bg-[#FEA85E]/10 text-[#fff0e4]"
						}`}
					>
						<div className="flex items-center justify-between gap-3 text-sm font-semibold">
							<span>{operationError ? "Audio action failed" : operationLabel}</span>
							{operationPhase !== "idle" && operationPhase !== "done" ? (
								<Loader2 className="h-4 w-4 animate-spin text-[#FEA85E]" />
							) : null}
						</div>
						<div className="mt-1 text-xs text-[#c6b4a8]">{operationError ?? operationDetail}</div>
						{operationProgress !== null && !operationError ? (
							<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
								<div
									className="h-full rounded-full bg-[#FF6738]"
									style={{ width: `${Math.max(2, Math.min(100, operationProgress))}%` }}
								/>
							</div>
						) : null}
					</div>
				) : null}

				<div className="rounded-xl border border-white/10 bg-[#120d0c] p-4">
					<div className="mb-3 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.14em] text-[#8f7e73]">
						<span>Recording Voice</span>
						<span>
							{formatAudioTime(currentTime)} / {formatAudioTime(videoDuration)}
						</span>
					</div>
					<div className="space-y-3">
						<AudioTrack
							label="Original Voice"
							detail={voiceover.enabled ? "Replaced by AI voice on export" : "Used on export"}
							peaks={sourcePeaks}
							playheadPercent={playheadPercent}
							videoDuration={videoDuration}
							trimRegions={trimRegions}
							tone="source"
						/>
						<AudioTrack
							label="AI Voice"
							detail={
								voiceover.audioFilePath
									? voiceover.enabled
										? "Enabled on export"
										: "Generated, not used on export"
									: "Generated from transcript"
							}
							peaks={voicePeaks}
							playheadPercent={playheadPercent}
							videoDuration={videoDuration}
							tone="voiceover"
						/>
					</div>

					<TranscriptOverlay
						segments={transcriptSegments}
						durationSeconds={voiceover.transcriptionDurationSeconds ?? videoDuration}
						currentTime={currentTime}
					/>

					<div className="mt-3 flex flex-wrap items-center gap-2">
						{voiceover.audioFilePath ? (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								onClick={() =>
									onVoiceoverChange({
										...voiceover,
										enabled: !voiceover.enabled,
										exportMode: "replace",
									})
								}
								className="h-8 bg-white/10 text-xs text-[#fff0e4] hover:bg-white/15"
							>
								<CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
								{voiceover.enabled ? "Use Original Voice" : "Use AI Voice"}
							</Button>
						) : null}
						{voiceover.audioFileUrl ? (
							<div className="min-w-[280px] flex-1">
								<audio controls src={voiceover.audioFileUrl} className="h-8 w-full" />
							</div>
						) : null}
					</div>
				</div>

				<div className="mt-3 rounded-xl border border-white/10 bg-[#120d0c] p-3">
					<div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#fff0e4]">
						<Volume2 className="h-3.5 w-3.5 text-[#FEA85E]" />
						Transcript
					</div>
					<div className="text-sm leading-6 text-[#c6b4a8]">
						{activeTranscript ? (
							<span className="rounded bg-[#FF6738]/20 px-1 text-[#fff0e4]">
								{activeTranscript.text}
							</span>
						) : transcript ? (
							transcript
						) : (
							<span className="text-[#8f7e73]">
								No transcript yet. Use Transcribe or AI Voice to extract the recording speech.
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
