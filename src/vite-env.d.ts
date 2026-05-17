/// <reference types="vite/client" />
/// <reference types="../electron/electron-env" />

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

interface Window {
	electronAPI: {
		getSources: (opts: Electron.SourcesOptions) => Promise<ProcessedDesktopSource[]>;
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
		setCurrentWindowSize: (
			width: number,
			height: number,
		) => Promise<{ success: boolean; error?: string }>;
		selectSource: (source: ProcessedDesktopSource) => Promise<ProcessedDesktopSource | null>;
		getSelectedSource: () => Promise<ProcessedDesktopSource | null>;
		requestCameraAccess: () => Promise<{
			success: boolean;
			granted: boolean;
			status: string;
			error?: string;
		}>;
		storeRecordedVideo: (
			videoData: ArrayBuffer,
			fileName: string,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("./lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		storeRecordedSession: (
			payload: import("./lib/recordingSession").StoreRecordedSessionInput,
		) => Promise<{
			success: boolean;
			path?: string;
			session?: import("./lib/recordingSession").RecordingSession;
			message?: string;
			error?: string;
		}>;
		getRecordedVideoPath: () => Promise<{
			success: boolean;
			path?: string;
			message?: string;
			error?: string;
		}>;
		getAssetBasePath: () => Promise<string | null>;
		setRecordingState: (recording: boolean) => Promise<void>;
		getCursorTelemetry: (videoPath?: string) => Promise<{
			success: boolean;
			samples: CursorTelemetryPoint[];
			message?: string;
			error?: string;
		}>;
		docsieGetState: () => Promise<{
			success: boolean;
			state?: import("./lib/docsieIntegration").DocsieIntegrationState;
			error?: string;
		}>;
		docsieSaveConfig: (
			input: import("./lib/docsieIntegration").DocsieIntegrationConfigInput,
		) => Promise<{
			success: boolean;
			state?: import("./lib/docsieIntegration").DocsieIntegrationState;
			error?: string;
		}>;
		docsieListWorkspaces: () => Promise<{
			success: boolean;
			workspaces: import("./lib/docsieIntegration").DocsieWorkspace[];
			error?: string;
		}>;
		docsieListDocumentationShelves: (
			input?: import("./lib/docsieIntegration").DocsieListDocumentationShelvesInput,
		) => Promise<{
			success: boolean;
			shelves: import("./lib/docsieIntegration").DocsieDocumentationShelf[];
			error?: string;
		}>;
		docsieListGenerationTemplates: () => Promise<{
			success: boolean;
			templates: import("./lib/docsieIntegration").DocsieGenerationTemplate[];
			error?: string;
		}>;
		docsieListVoiceOptions: (
			input?: import("./lib/docsieIntegration").DocsieListVoiceOptionsInput,
		) => Promise<import("./lib/docsieIntegration").DocsieVoiceOptionsResult>;
		docsieListTranscriptionOptions: () => Promise<
			import("./lib/docsieIntegration").DocsieTranscriptionOptionsResult
		>;
		docsieTranscribeAudio: (
			input: import("./lib/docsieIntegration").DocsieTranscribeAudioInput,
		) => Promise<import("./lib/docsieIntegration").DocsieTranscriptionResult>;
		docsieGenerateVoiceover: (
			input: import("./lib/docsieIntegration").DocsieGenerateVoiceoverInput,
		) => Promise<import("./lib/docsieIntegration").DocsieGenerateVoiceoverResult>;
		docsieEstimateVideoToDocs: (
			input: import("./lib/docsieIntegration").DocsieEstimateInput,
		) => Promise<import("./lib/docsieIntegration").DocsieEstimateResult>;
		docsieGetCreditBalance: () => Promise<
			import("./lib/docsieIntegration").DocsieCreditBalanceResult
		>;
		docsieStartVideoToDocs: (
			input: import("./lib/docsieIntegration").DocsieStartVideoToDocsInput,
		) => Promise<import("./lib/docsieIntegration").DocsieStartVideoToDocsResult>;
		docsieGenerateVideoToDocs: (
			input: import("./lib/docsieIntegration").DocsieGenerateVideoToDocsInput,
		) => Promise<import("./lib/docsieIntegration").DocsieGenerateVideoToDocsResult>;
		docsieGetJobStatus: (
			jobId: string,
		) => Promise<import("./lib/docsieIntegration").DocsieVideoToDocsJobStatus>;
		docsieGetJobResult: (
			jobId: string,
		) => Promise<import("./lib/docsieIntegration").DocsieVideoToDocsJobResult>;
		docsieGetBackgroundJob: (
			jobId: string,
		) => Promise<import("./lib/docsieIntegration").DocsieAsyncJobResult>;
		docsieListVideoToDocsHistory: (videoPath: string) => Promise<{
			success: boolean;
			entries: import("./lib/docsieIntegration").DocsieVideoToDocsHistoryEntry[];
			error?: string;
		}>;
		docsieSaveVideoToDocsHistory: (
			input: import("./lib/docsieIntegration").DocsieSaveVideoToDocsHistoryInput,
		) => Promise<{
			success: boolean;
			entry?: import("./lib/docsieIntegration").DocsieVideoToDocsHistoryEntry;
			error?: string;
		}>;
		onDocsieDesktopAuthEvent: (
			callback: (event: import("./lib/docsieIntegration").DocsieDesktopAuthEvent) => void,
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
			session: import("./lib/recordingSession").RecordingSession | null,
		) => Promise<{
			success: boolean;
			session?: import("./lib/recordingSession").RecordingSession;
		}>;
		getCurrentVideoPath: () => Promise<{ success: boolean; path?: string }>;
		getCurrentRecordingSession: () => Promise<{
			success: boolean;
			session?: import("./lib/recordingSession").RecordingSession;
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
		setMicrophoneExpanded: (expanded: boolean) => void;
		setHasUnsavedChanges: (hasChanges: boolean) => void;
		onRequestSaveBeforeClose: (callback: () => Promise<boolean> | boolean) => () => void;
		setLocale: (locale: string) => Promise<void>;
	};
}
