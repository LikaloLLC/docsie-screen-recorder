export interface ProjectMedia {
	screenVideoPath: string;
	webcamVideoPath?: string;
	audioPath?: string;
}

export interface RecordingSession extends ProjectMedia {
	createdAt: number;
}

export interface RecordedVideoAssetInput {
	fileName: string;
	videoData: ArrayBuffer;
}

export interface RecordedAudioAssetInput {
	fileName: string;
	audioData: ArrayBuffer;
}

export interface StoreRecordedSessionInput {
	screen: RecordedVideoAssetInput;
	webcam?: RecordedVideoAssetInput;
	audio?: RecordedAudioAssetInput;
	createdAt?: number;
}

export type RecordingAssetKind = "screen" | "webcam" | "audio";

export interface RecordingAssetDescriptor {
	fileName: string;
}

export interface BeginRecordingSessionInput {
	recordingId: number;
	screen: RecordingAssetDescriptor;
	webcam?: RecordingAssetDescriptor;
	audio?: RecordingAssetDescriptor;
	createdAt?: number;
}

export interface AppendRecordingChunkInput {
	recordingId: number;
	kind: RecordingAssetKind;
	data: ArrayBuffer;
}

export interface ReplaceRecordingAssetInput {
	recordingId: number;
	kind: RecordingAssetKind;
	data: ArrayBuffer;
}

export interface FinishRecordingSessionInput {
	recordingId: number;
}

export interface DiscardRecordingSessionInput {
	recordingId: number;
}

function normalizePath(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

export function normalizeProjectMedia(candidate: unknown): ProjectMedia | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<ProjectMedia>;
	const screenVideoPath = normalizePath(raw.screenVideoPath);

	if (!screenVideoPath) {
		return null;
	}

	const webcamVideoPath = normalizePath(raw.webcamVideoPath);
	const audioPath = normalizePath(raw.audioPath);

	return {
		screenVideoPath,
		...(webcamVideoPath ? { webcamVideoPath } : {}),
		...(audioPath ? { audioPath } : {}),
	};
}

export function normalizeRecordingSession(candidate: unknown): RecordingSession | null {
	if (!candidate || typeof candidate !== "object") {
		return null;
	}

	const raw = candidate as Partial<RecordingSession>;
	const media = normalizeProjectMedia(raw);
	if (!media) {
		return null;
	}

	return {
		...media,
		createdAt:
			typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
				? raw.createdAt
				: Date.now(),
	};
}
