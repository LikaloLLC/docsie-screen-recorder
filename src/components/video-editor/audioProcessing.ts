import type { DocsieTranscriptionResult } from "@/lib/docsieIntegration";
import type { VoiceoverTranscriptSegment } from "./types";

const TRANSCRIPTION_AUDIO_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"];

export interface AudioExtractionProgress {
	currentSeconds: number;
	durationSeconds: number;
	percentage: number;
}

export interface AudioExtractionOptions {
	onProgress?: (progress: AudioExtractionProgress) => void;
}

export function normalizeVoiceoverFilename(videoPath: string | null) {
	const base =
		videoPath
			?.split(/[\\/]/)
			.pop()
			?.replace(/\.[^.]+$/, "") || "screen-recorder";
	return `${base.replace(/[^a-zA-Z0-9._-]+/g, "-") || "screen-recorder"}-voiceover`;
}

export function normalizeTranscriptionAudioFilename(videoPath: string | null) {
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
			reject(new Error("Failed to load media audio"));
		};
		const cleanup = () => {
			media.removeEventListener("loadedmetadata", onLoaded);
			media.removeEventListener("error", onError);
		};

		media.addEventListener("loadedmetadata", onLoaded);
		media.addEventListener("error", onError, { once: true });
	});
}

export async function extractAudioForTranscription(
	videoUrl: string,
	options: AudioExtractionOptions = {},
) {
	const media = document.createElement("video");
	media.src = videoUrl;
	media.preload = "auto";
	media.playsInline = true;

	await waitForMediaMetadata(media);
	const durationSeconds =
		Number.isFinite(media.duration) && media.duration > 0 ? media.duration : 0;
	options.onProgress?.({ currentSeconds: 0, durationSeconds, percentage: 0 });

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
	let progressFrame: number | null = null;
	try {
		if (audioContext.state === "suspended") {
			await audioContext.resume();
		}
		recorder.start();
		const reportProgress = () => {
			if (durationSeconds > 0) {
				options.onProgress?.({
					currentSeconds: Math.min(media.currentTime, durationSeconds),
					durationSeconds,
					percentage: Math.max(0, Math.min(100, (media.currentTime / durationSeconds) * 100)),
				});
			}
			progressFrame = requestAnimationFrame(reportProgress);
		};
		progressFrame = requestAnimationFrame(reportProgress);
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
		if (progressFrame !== null) {
			cancelAnimationFrame(progressFrame);
		}
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
	options.onProgress?.({ currentSeconds: durationSeconds, durationSeconds, percentage: 100 });

	return {
		audioData: await blob.arrayBuffer(),
		contentType: blob.type || "audio/webm",
	};
}

export async function buildWaveformPeaksFromArrayBuffer(audioData: ArrayBuffer, sampleCount = 220) {
	const audioContext = new AudioContext();
	try {
		const decoded = await audioContext.decodeAudioData(audioData.slice(0));
		const channelCount = Math.max(1, decoded.numberOfChannels);
		const bucketSize = Math.max(1, Math.floor(decoded.length / sampleCount));
		const peaks: number[] = [];

		for (let i = 0; i < sampleCount; i += 1) {
			const start = i * bucketSize;
			const end = Math.min(decoded.length, start + bucketSize);
			let sum = 0;
			let samples = 0;

			for (let channel = 0; channel < channelCount; channel += 1) {
				const channelData = decoded.getChannelData(channel);
				for (let sample = start; sample < end; sample += 1) {
					const value = channelData[sample] ?? 0;
					sum += value * value;
					samples += 1;
				}
			}

			const rms = samples > 0 ? Math.sqrt(sum / samples) : 0;
			peaks.push(Math.min(1, Math.max(0.04, rms * 4)));
		}

		return peaks;
	} finally {
		await audioContext.close();
	}
}

export async function buildWaveformPeaksFromMediaUrl(mediaUrl: string, sampleCount = 220) {
	const response = await fetch(mediaUrl);
	if (!response.ok) {
		throw new Error(`Failed to load waveform media: ${response.status}`);
	}
	return buildWaveformPeaksFromArrayBuffer(await response.arrayBuffer(), sampleCount);
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (typeof value === "string" && value.trim()) {
			const parsed = Number.parseFloat(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	return undefined;
}

function readString(record: Record<string, unknown>, keys: string[]) {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

export function normalizeTranscriptSegments(
	result: DocsieTranscriptionResult,
): VoiceoverTranscriptSegment[] {
	const normalized: VoiceoverTranscriptSegment[] = [];
	for (const segment of result.segments ?? []) {
		if (!segment || typeof segment !== "object" || Array.isArray(segment)) {
			continue;
		}
		const record = segment as Record<string, unknown>;
		const start = readNumber(record, ["start_ms", "startMs", "start", "from"]);
		const end = readNumber(record, ["end_ms", "endMs", "end", "to"]);
		const text = readString(record, ["text", "transcript", "sentence", "word"]);
		if (start === undefined || end === undefined || !text) {
			continue;
		}
		const startMs = start > 10_000 ? start : start * 1000;
		const endMs = end > 10_000 ? end : end * 1000;
		if (endMs <= startMs) {
			continue;
		}
		normalized.push({ startMs, endMs, text });
	}

	return normalized;
}
