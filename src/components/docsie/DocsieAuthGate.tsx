import { Loader2, LogIn, RefreshCcw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getBundledAssetUrl } from "@/lib/assets";
import type { DocsieDesktopConnectParams } from "@/lib/docsieIntegration";
import {
	buildDocsieDesktopLoginUrl,
	buildDocsieDesktopSignupUrl,
	getDocsieWebAppUrl,
} from "@/lib/docsieIntegration";
import { cn } from "@/lib/utils";

type DocsieAuthGateVariant = "hud" | "panel";

interface DocsieAuthGateProps {
	title: string;
	description: string;
	variant?: DocsieAuthGateVariant;
	webAppUrl?: string | null;
	connectParams?: DocsieDesktopConnectParams;
	loading?: boolean;
	onRefresh?: () => Promise<void> | void;
	onClose?: () => void;
	closeLabel?: string;
	interactiveClassName?: string;
}

export function DocsieAuthGate({
	title,
	description,
	variant = "panel",
	webAppUrl,
	connectParams,
	loading = false,
	onRefresh,
	onClose,
	closeLabel = "Close",
	interactiveClassName,
}: DocsieAuthGateProps) {
	const resolvedWebAppUrl = getDocsieWebAppUrl(webAppUrl);
	const signInUrl = buildDocsieDesktopLoginUrl(resolvedWebAppUrl, connectParams);
	const signupUrl = buildDocsieDesktopSignupUrl(resolvedWebAppUrl, connectParams);
	const docsieMarkUrl = getBundledAssetUrl("docsie_mark.svg");

	const openUrl = async (url: string, label: string) => {
		const result = await window.electronAPI.openExternalUrl(url);
		if (!result.success) {
			toast.error(result.error ?? `Unable to open ${label}`);
		}
	};

	const compact = variant === "hud";

	return (
		<div
			className={cn(
				compact
					? "w-full rounded-[28px] border border-[rgba(254,168,94,0.16)] bg-[linear-gradient(135deg,rgba(45,32,28,0.97),rgba(23,17,15,0.96))] px-4 py-3 shadow-[0_24px_60px_rgba(0,0,0,0.35)] backdrop-blur-[18px]"
					: "w-full max-w-[560px] rounded-[28px] border border-[rgba(254,168,94,0.16)] bg-[linear-gradient(160deg,rgba(45,32,28,0.97),rgba(23,17,15,0.98))] px-6 py-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-[18px]",
			)}
		>
			<div className={cn("flex items-start gap-3", compact ? "mb-3" : "mb-5")}>
				<div
					className={cn(
						"flex shrink-0 items-center justify-center rounded-2xl border border-[rgba(255,103,56,0.22)] bg-[rgba(255,103,56,0.12)] text-[#FEA85E]",
						compact ? "h-10 w-10" : "h-12 w-12",
					)}
				>
					<img
						src={docsieMarkUrl}
						alt="Docsie"
						className={compact ? "h-5 w-5 object-contain" : "h-7 w-7 object-contain"}
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#FEA85E]">
						Docsie account required
					</div>
					<h1 className={cn("mt-1 font-semibold text-[#FFF0E4]", compact ? "text-sm" : "text-2xl")}>
						{title}
					</h1>
					<p
						className={cn(
							"mt-1 leading-relaxed text-[#FDD2A3]/75",
							compact ? "text-[11px]" : "text-sm",
						)}
					>
						{description}
					</p>
				</div>
			</div>

			<div className={cn("flex flex-wrap gap-2", compact ? "items-center" : "items-stretch")}>
				<Button
					type="button"
					size={compact ? "sm" : "default"}
					onClick={() => void openUrl(signInUrl, "Docsie sign in")}
					disabled={loading}
					className={cn(
						"rounded-full bg-[#FF6738] text-white hover:bg-[#E85A2F]",
						compact ? "h-8 px-3 text-[11px]" : "px-4",
						interactiveClassName,
					)}
				>
					<LogIn className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
					Sign In
				</Button>
				<Button
					type="button"
					size={compact ? "sm" : "default"}
					variant="outline"
					onClick={() => void openUrl(signupUrl, "Docsie sign up")}
					disabled={loading}
					className={cn(
						"rounded-full border-[rgba(254,168,94,0.18)] bg-transparent text-[#FFF0E4] hover:bg-white/5 hover:text-white",
						compact ? "h-8 px-3 text-[11px]" : "px-4",
						interactiveClassName,
					)}
				>
					<UserPlus className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
					Create Account
				</Button>
				{onRefresh ? (
					<Button
						type="button"
						size={compact ? "sm" : "default"}
						variant="ghost"
						onClick={() => void onRefresh()}
						disabled={loading}
						className={cn(
							"rounded-full text-[#FDD2A3]/75 hover:bg-white/5 hover:text-white",
							compact ? "h-8 px-3 text-[11px]" : "px-4",
							interactiveClassName,
						)}
					>
						{loading ? (
							<Loader2 className={compact ? "h-3.5 w-3.5 animate-spin" : "h-4 w-4 animate-spin"} />
						) : (
							<RefreshCcw className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
						)}
						{loading ? "Checking" : "I Connected Docsie"}
					</Button>
				) : null}
				{onClose ? (
					<Button
						type="button"
						size={compact ? "sm" : "default"}
						variant="ghost"
						onClick={onClose}
						className={cn(
							"rounded-full text-[#FDD2A3]/55 hover:bg-white/5 hover:text-white",
							compact ? "h-8 px-3 text-[11px]" : "px-4",
							interactiveClassName,
						)}
					>
						{closeLabel}
					</Button>
				) : null}
			</div>

			<p className={cn("mt-3 text-[#FDD2A3]/55", compact ? "text-[10px]" : "text-xs")}>
				After sign-in, the recorder unlocks and saves into your Docsie workspace context.
			</p>
		</div>
	);
}
