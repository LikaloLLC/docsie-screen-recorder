/// <reference types="vite-plugin-electron/electron-env" />

declare namespace NodeJS {
	interface ProcessEnv {
		/**
		 * The built directory structure
		 *
		 * ```tree
		 * ├─┬─┬ dist
		 * │ │ └── index.html
		 * │ │
		 * │ ├─┬ dist-electron
		 * │ │ ├── main.js
		 * │ │ └── preload.js
		 * │
		 * ```
		 */
		APP_ROOT: string;
		/** /dist/ or /public/ */
		VITE_PUBLIC: string;
	}
}

// Used in Renderer process, expose in `preload.ts`
interface Window {
	electronAPI: {
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
		getScreenCaptureAccess: () => Promise<ScreenCaptureAccessState>;
		openScreenCaptureSettings: () => Promise<{
			success: boolean;
			error?: string;
		}>;
		switchToEditor: () => Promise<void>;
		switchToHud: () => Promise<void>;
		startNewRecording: () => Promise<{ success: boolean; error?: string }>;
		openSourceSelector: () => Promise<void>;
		minimizeCurrentWindow: () => Promise<{ success: boolean; error?: string }>;
		closeCurrentWindow: () => Promise<{ success: boolean; error?: string }>;
		restartApp: () => Promise<{ success: boolean; error?: string }>;
		setCurrentWindowSize: (
			width: number,
			height: number,
		) => Promise<{ success: boolean; error?: string }>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource | null>;
		selectDefaultSource: () => Promise<ProcessedDesktopSource | null>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		requestCameraAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		getAssetBasePath: () => Promise<string | null>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		storeRecordedSession: (
			payload: import("../src/lib/recordingSession").StoreRecordedSessionInput,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		beginRecordingSession: (
			input: import("../src/lib/recordingSession").BeginRecordingSessionInput,
		) => Promise<{ success: boolean; path?: string; message?: string; error?: string }>;
		appendRecordingChunk: (
			input: import("../src/lib/recordingSession").AppendRecordingChunkInput,
		) => Promise<{
			success: boolean;
			path?: string;
			bytesWritten?: number;
			message?: string;
			error?: string;
		}>;
		replaceRecordingAsset: (
			input: import("../src/lib/recordingSession").ReplaceRecordingAssetInput,
		) => Promise<{
			success: boolean;
			path?: string;
			bytesWritten?: number;
			message?: string;
			error?: string;
		}>;
		finishRecordingSession: (
			input: import("../src/lib/recordingSession").FinishRecordingSessionInput,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("../src/lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		discardRecordingSession: (
			input: import("../src/lib/recordingSession").DiscardRecordingSessionInput,
		) => Promise<{ success: boolean; message?: string; error?: string }>;
		getRecordedVideoPath: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		setRecordingState: (recording: boolean) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		docsieGetState: () => Promise<{
			success: boolean;
			state?: import("../src/lib/docsieIntegration").DocsieIntegrationState;
			error?: string;
		}>;
		docsieSaveConfig: (
			input: import("../src/lib/docsieIntegration").DocsieIntegrationConfigInput,
		) => Promise<{
			success: boolean;
			state?: import("../src/lib/docsieIntegration").DocsieIntegrationState;
			error?: string;
		}>;
		docsieListWorkspaces: () => Promise<{
			success: boolean;
			workspaces: import("../src/lib/docsieIntegration").DocsieWorkspace[];
			error?: string;
		}>;
		docsieListDocumentationShelves: (
			input?: import("../src/lib/docsieIntegration").DocsieListDocumentationShelvesInput,
		) => Promise<{
			success: boolean;
			shelves: import("../src/lib/docsieIntegration").DocsieDocumentationShelf[];
			error?: string;
		}>;
		docsieListGenerationTemplates: () => Promise<{
			success: boolean;
			templates: import("../src/lib/docsieIntegration").DocsieGenerationTemplate[];
			error?: string;
		}>;
		docsieListVoiceOptions: (
			input?: import("../src/lib/docsieIntegration").DocsieListVoiceOptionsInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieVoiceOptionsResult>;
		docsieListTranscriptionOptions: () => Promise<
			import("../src/lib/docsieIntegration").DocsieTranscriptionOptionsResult
		>;
		docsieTranscribeAudio: (
			input: import("../src/lib/docsieIntegration").DocsieTranscribeAudioInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieTranscriptionResult>;
		docsieGenerateVoiceover: (
			input: import("../src/lib/docsieIntegration").DocsieGenerateVoiceoverInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieGenerateVoiceoverResult>;
		docsieEstimateVideoToDocs: (
			input: import("../src/lib/docsieIntegration").DocsieEstimateInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieEstimateResult>;
		docsieGetCreditBalance: () => Promise<
			import("../src/lib/docsieIntegration").DocsieCreditBalanceResult
		>;
		docsieStartVideoToDocs: (
			input: import("../src/lib/docsieIntegration").DocsieStartVideoToDocsInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieStartVideoToDocsResult>;
		docsieGenerateVideoToDocs: (
			input: import("../src/lib/docsieIntegration").DocsieGenerateVideoToDocsInput,
		) => Promise<import("../src/lib/docsieIntegration").DocsieGenerateVideoToDocsResult>;
		docsieGetJobStatus: (
			jobId: string,
		) => Promise<import("../src/lib/docsieIntegration").DocsieVideoToDocsJobStatus>;
		docsieGetJobResult: (
			jobId: string,
		) => Promise<import("../src/lib/docsieIntegration").DocsieVideoToDocsJobResult>;
		docsieGetBackgroundJob: (
			jobId: string,
		) => Promise<import("../src/lib/docsieIntegration").DocsieAsyncJobResult>;
		docsieListVideoToDocsHistory: (videoPath: string) => Promise<{
			success: boolean;
			entries: import("../src/lib/docsieIntegration").DocsieVideoToDocsHistoryEntry[];
			error?: string;
		}>;
		docsieSaveVideoToDocsHistory: (
			input: import("../src/lib/docsieIntegration").DocsieSaveVideoToDocsHistoryInput,
		) => Promise<{
			success: boolean;
			entry?: import("../src/lib/docsieIntegration").DocsieVideoToDocsHistoryEntry;
			error?: string;
		}>;
		onDocsieDesktopAuthEvent: (
			callback: (event: import("../src/lib/docsieIntegration").DocsieDesktopAuthEvent) => void,
		) => () => void;
		onStopRecordingFromTray: (callback: () => void) => () => void;
		openExternalUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
		saveExportedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
		}>;
		saveTextFile: (
			textContent: string,
			fileName: string,
			filters?: Array<{ name: string; extensions: string[] }>,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		openVideoFilePicker: () => Promise<{
			success: boolean;
			path?: string;
			canceled?: boolean;
		}>;
		setCurrentVideoPath: (path: string) => Promise<{ success: boolean }>;
		setCurrentRecordingSession: (
			session: import("../src/lib/recordingSession").RecordingSession | null,
		) => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: import("../src/lib/recordingSession").RecordingSession;
		}>;
		readBinaryFile: (filePath: string) => Promise<{
			success: boolean;
			data?: ArrayBuffer;
			path?: string;
			message?: string;
			error?: string;
		}>;
		clearCurrentVideoPath: () => Promise<{ success: boolean }>;
		saveProjectFile: (
			projectData: unknown,
			suggestedName?: string,
			existingProjectPath?: string,
		) => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		loadCurrentProjectFile: () => Promise<{
			success: boolean;
			path?: string;
			project?: unknown;
			message?: string;
			canceled?: boolean;
			error?: string;
		}>;
		onMenuLoadProject: (callback: () => void) => () => void;
		onMenuSaveProject: (callback: () => void) => () => void;
		onMenuSaveProjectAs: (callback: () => void) => () => void;
		getPlatform: () => Promise<string>;
		revealInFolder: (
			filePath: string,
		) => Promise<{ success: boolean; error?: string; message?: string }>;
		getShortcuts: () => Promise<Record<string, unknown> | null>;
		saveShortcuts: (shortcuts: unknown) => Promise<{ success: boolean; error?: string }>;
		hudOverlayHide: () => void;
		hudOverlayClose: () => void;
		showCountdownOverlay: (value: number, runId: number) => Promise<void>;
		setCountdownOverlayValue: (value: number, runId: number) => Promise<void>;
		hideCountdownOverlay: (runId: number) => Promise<void>;
		onCountdownOverlayValue: (callback: (value: number | null) => void) => () => void;
		setMicrophoneExpanded: (expanded: boolean) => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => () => void;
		setLocale: (locale: string) => Promise<void>;
	};
}

interface ProcessedDesktopSource {
	id: string;
	name: string;
	display_id: string;
	thumbnail: string | null;
	appIcon: string | null;
}

interface CursorTelemetryPoint {
	timeMs: number;
	cx: number;
	cy: number;
}
