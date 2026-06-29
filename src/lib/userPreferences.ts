import type { ExportFormat, ExportQuality } from "@/lib/exporter";
import type { AspectRatio } from "@/utils/aspectRatioUtils";

const PREFS_KEY = "openscreen_user_preferences";
const PREFS_DEFAULTS_VERSION = 2;

const VALID_ASPECT_RATIOS: readonly string[] = [
	"16:9",
	"9:16",
	"1:1",
	"4:3",
	"4:5",
	"16:10",
	"10:16",
	"native",
];

export interface UserPreferences {
	/** Default padding % */
	padding: number;
	/** Default aspect ratio */
	aspectRatio: AspectRatio;
	/** Default export quality */
	exportQuality: ExportQuality;
	/** Default export format */
	exportFormat: ExportFormat;
}

const DEFAULT_PREFS: UserPreferences = {
	padding: 0,
	aspectRatio: "native",
	exportQuality: "source",
	exportFormat: "mp4",
};

function safeJsonParse(text: string | null): Record<string, unknown> | null {
	if (!text) return null;
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function normalizePadding(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
		? value
		: DEFAULT_PREFS.padding;
}

function normalizeAspectRatio(value: unknown): AspectRatio {
	return typeof value === "string" && VALID_ASPECT_RATIOS.includes(value)
		? (value as AspectRatio)
		: DEFAULT_PREFS.aspectRatio;
}

function normalizeExportQuality(value: unknown): ExportQuality {
	return value === "medium" || value === "good" || value === "source"
		? (value as ExportQuality)
		: DEFAULT_PREFS.exportQuality;
}

function normalizeExportFormat(value: unknown): ExportFormat {
	return value === "gif" || value === "mp4" ? (value as ExportFormat) : DEFAULT_PREFS.exportFormat;
}

function hasLegacyCompositionDefaults(raw: Record<string, unknown>): boolean {
	const storedVersion =
		typeof raw.defaultsVersion === "number" && Number.isFinite(raw.defaultsVersion)
			? raw.defaultsVersion
			: 1;
	if (storedVersion >= PREFS_DEFAULTS_VERSION) return false;

	const hasOldPadding = raw.padding === undefined || raw.padding === 50;
	const hasOldAspectRatio = raw.aspectRatio === undefined || raw.aspectRatio === "16:9";

	return hasOldPadding && hasOldAspectRatio;
}

/**
 * Load persisted user preferences from localStorage.
 * Returns defaults for any missing or invalid fields.
 */
export function loadUserPreferences(): UserPreferences {
	let raw: Record<string, unknown> | null = null;
	try {
		raw = safeJsonParse(localStorage.getItem(PREFS_KEY));
	} catch {
		return { ...DEFAULT_PREFS };
	}
	if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };

	if (hasLegacyCompositionDefaults(raw)) {
		return {
			...DEFAULT_PREFS,
			exportQuality:
				raw.exportQuality === "medium" || raw.exportQuality === "source"
					? raw.exportQuality
					: DEFAULT_PREFS.exportQuality,
			exportFormat: normalizeExportFormat(raw.exportFormat),
		};
	}

	return {
		padding: normalizePadding(raw.padding),
		aspectRatio: normalizeAspectRatio(raw.aspectRatio),
		exportQuality: normalizeExportQuality(raw.exportQuality),
		exportFormat: normalizeExportFormat(raw.exportFormat),
	};
}

/**
 * Persist user preferences to localStorage.
 * Only the explicitly provided fields are updated.
 */
export function saveUserPreferences(partial: Partial<UserPreferences>): void {
	const current = loadUserPreferences();
	const merged = { ...current, ...partial };
	try {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({ ...merged, defaultsVersion: PREFS_DEFAULTS_VERSION }),
		);
	} catch {
		// localStorage may be unavailable (e.g. private browsing quota exceeded)
	}
}
