import { useCallback, useEffect, useState } from "react";
import type { DocsieDesktopAuthEvent, DocsieIntegrationState } from "@/lib/docsieIntegration";

export function useDocsieAuthState(enabled = true) {
	const [loading, setLoading] = useState(enabled);
	const [state, setState] = useState<DocsieIntegrationState | null>(null);

	const refresh = useCallback(async () => {
		if (!enabled) {
			setLoading(false);
			return;
		}

		setLoading(true);
		try {
			const result = await window.electronAPI.docsieGetState();
			if (!result.success) {
				setState(null);
				return;
			}

			setState(result.state ?? null);
		} catch (error) {
			console.error("Failed to load Docsie desktop auth state:", error);
			setState(null);
		} finally {
			setLoading(false);
		}
	}, [enabled]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		const handleDesktopAuthEvent = (event: Event) => {
			const customEvent = event as CustomEvent<DocsieDesktopAuthEvent>;
			if (customEvent.detail?.state) {
				setState(customEvent.detail.state);
				setLoading(false);
				return;
			}

			void refresh();
		};

		window.addEventListener("docsie-desktop-auth-event", handleDesktopAuthEvent as EventListener);
		return () => {
			window.removeEventListener(
				"docsie-desktop-auth-event",
				handleDesktopAuthEvent as EventListener,
			);
		};
	}, [enabled, refresh]);

	return {
		loading,
		state,
		isConnected: Boolean(state?.hasToken),
		refresh,
	};
}
