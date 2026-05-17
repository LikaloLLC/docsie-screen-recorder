import { CheckCircle2, Loader2, LogIn, RefreshCcw, Save, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
	DocsieCreditBalance,
	DocsieIntegrationState,
	DocsieTranscriptionOptionsResult,
	DocsieVoiceOptionsResult,
} from "@/lib/docsieIntegration";
import { buildDocsieDesktopLoginUrl, getDocsieWebAppUrl } from "@/lib/docsieIntegration";

interface AISettingsDialogProps {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
}

function buildApiBaseUrl(webAppUrl: string, currentApiBaseUrl: string) {
	const current = currentApiBaseUrl.trim();
	if (current) {
		return current;
	}

	const base = getDocsieWebAppUrl(webAppUrl);
	return new URL("/api_v2/003", `${base}/`).toString().replace(/\/+$/, "");
}

function formatCreditBalance(balance: DocsieCreditBalance | null) {
	if (typeof balance?.totalAvailable !== "number") {
		return "Unavailable";
	}
	return `${balance.totalAvailable.toLocaleString()} credits`;
}

export function AISettingsDialog({ isOpen, onOpenChange, onSaved }: AISettingsDialogProps) {
	const [apiBaseUrl, setApiBaseUrl] = useState("");
	const [webAppUrl, setWebAppUrl] = useState(getDocsieWebAppUrl(""));
	const [authMode, setAuthMode] = useState<DocsieAuthMode>("bearer");
	const [tokenInput, setTokenInput] = useState("");
	const [state, setState] = useState<DocsieIntegrationState | null>(null);
	const [creditBalance, setCreditBalance] = useState<DocsieCreditBalance | null>(null);
	const [voiceOptions, setVoiceOptions] = useState<DocsieVoiceOptionsResult | null>(null);
	const [transcriptionOptions, setTranscriptionOptions] =
		useState<DocsieTranscriptionOptionsResult | null>(null);
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState(false);

	const loadSettings = useCallback(async () => {
		setLoading(true);
		try {
			const result = await window.electronAPI.docsieGetState();
			if (!result.success || !result.state) {
				setState(null);
				setCreditBalance(null);
				setVoiceOptions(null);
				setTranscriptionOptions(null);
				return;
			}

			const nextState = result.state;
			setState(nextState);
			setApiBaseUrl(nextState.apiBaseUrl);
			setWebAppUrl(getDocsieWebAppUrl(nextState.apiBaseUrl));
			setAuthMode(nextState.authMode);

			if (nextState.hasToken) {
				const [credits, voices, transcription] = await Promise.all([
					window.electronAPI.docsieGetCreditBalance(),
					window.electronAPI.docsieListVoiceOptions(),
					window.electronAPI.docsieListTranscriptionOptions(),
				]);
				setCreditBalance(credits.success ? (credits.balance ?? null) : null);
				setVoiceOptions(voices);
				setTranscriptionOptions(transcription);
			} else {
				setCreditBalance(null);
				setVoiceOptions(null);
				setTranscriptionOptions(null);
			}
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		if (isOpen) {
			void loadSettings();
		}
	}, [isOpen, loadSettings]);

	const handleSignIn = useCallback(async () => {
		const url = buildDocsieDesktopLoginUrl(getDocsieWebAppUrl(apiBaseUrl || webAppUrl));
		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error ?? "Failed to open Docsie sign-in");
			return;
		}
		toast.success("Opened Docsie sign-in");
	}, [apiBaseUrl, webAppUrl]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			const result = await window.electronAPI.docsieSaveConfig({
				apiBaseUrl: buildApiBaseUrl(webAppUrl, apiBaseUrl),
				authMode,
				token: tokenInput,
			});

			if (!result.success || !result.state) {
				throw new Error(result.error ?? "Failed to save AI settings");
			}

			setState(result.state);
			setApiBaseUrl(result.state.apiBaseUrl);
			setWebAppUrl(getDocsieWebAppUrl(result.state.apiBaseUrl));
			setTokenInput("");
			toast.success("AI settings saved");
			onSaved?.();
			await loadSettings();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to save AI settings");
		} finally {
			setSaving(false);
		}
	}, [apiBaseUrl, authMode, loadSettings, onSaved, tokenInput, webAppUrl]);

	const configuredVoiceProviders =
		voiceOptions?.providers
			.filter((provider) => provider.configured)
			.map((provider) => provider.provider) ?? [];
	const transcriptionLanguages =
		transcriptionOptions?.languages.map((language) => language.name ?? language.code) ?? [];
	const voiceGenerationAvailable = Boolean(state?.voiceApiEnabled || voiceOptions?.success);
	const transcriptionAvailable = Boolean(
		state?.transcriptionApiEnabled || transcriptionOptions?.success,
	);

	return (
		<Dialog open={isOpen} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-hidden border border-[rgba(254,168,94,0.18)] bg-[#17110f] text-[#fff0e4] sm:max-w-[720px]">
				<DialogHeader>
					<DialogTitle className="text-[#fff0e4]">AI Settings</DialogTitle>
					<DialogDescription className="text-[#8f7e73]">
						Docsie AI connection, on-prem server settings, credits, and available AI features.
					</DialogDescription>
				</DialogHeader>

				<div className="grid max-h-[calc(90vh-10rem)] gap-4 overflow-y-auto pr-1">
					<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
						<div className="mb-3 flex items-start justify-between gap-3">
							<div>
								<div className="text-sm font-semibold text-[#fff0e4]">Connection</div>
								<div className="text-xs text-[#8f7e73]">
									{state?.hasToken
										? state.organizationName
											? `Connected to ${state.organizationName}`
											: "Connected"
										: "Not connected"}
								</div>
							</div>
							<div className="flex gap-2">
								<Button
									type="button"
									variant="secondary"
									onClick={() => void loadSettings()}
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
								<Button
									type="button"
									onClick={() => void handleSignIn()}
									className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
								>
									<LogIn className="mr-2 h-4 w-4" />
									Sign In
								</Button>
							</div>
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
									placeholder={state?.hasToken ? "Leave blank to keep saved token" : "Paste token"}
									className="border-white/10 bg-[#17110f] text-[#fff0e4]"
								/>
							</div>
						</div>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
							<div className="text-sm font-semibold text-[#fff0e4]">AI Credits</div>
							<div className="mt-2 text-2xl font-semibold text-[#FEA85E]">
								{loading ? "Loading" : formatCreditBalance(creditBalance)}
							</div>
							<div className="mt-1 text-xs text-[#8f7e73]">
								Shown in the editor top bar after connection.
							</div>
						</div>
						<div className="rounded-2xl border border-white/10 bg-[#120d0c] p-4">
							<div className="text-sm font-semibold text-[#fff0e4]">AI Capabilities</div>
							<div className="mt-3 space-y-2 text-sm">
								<div className="flex items-center gap-2">
									{voiceGenerationAvailable ? (
										<CheckCircle2 className="h-4 w-4 text-[#8ce18b]" />
									) : (
										<ShieldAlert className="h-4 w-4 text-[#8f7e73]" />
									)}
									<span>Voice generation</span>
								</div>
								<div className="flex items-center gap-2">
									{transcriptionAvailable ? (
										<CheckCircle2 className="h-4 w-4 text-[#8ce18b]" />
									) : (
										<ShieldAlert className="h-4 w-4 text-[#8f7e73]" />
									)}
									<span>Transcription</span>
								</div>
							</div>
							<div className="mt-3 text-xs text-[#8f7e73]">
								{configuredVoiceProviders.length
									? `Configured voices: ${configuredVoiceProviders.join(", ")}`
									: "Voice providers load after the server reports voice support."}
							</div>
							<div className="mt-1 text-xs text-[#8f7e73]">
								{transcriptionAvailable
									? transcriptionLanguages.length
										? `Transcription languages: ${transcriptionLanguages.slice(0, 6).join(", ")}`
										: "Transcription route is enabled."
									: "Transcription route is not enabled for this connection."}
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
					<Button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving}
						className="bg-[#FF6738] text-white hover:bg-[#FF6738]/90"
					>
						{saving ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						Save AI Settings
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
