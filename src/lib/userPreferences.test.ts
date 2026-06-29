import { beforeEach, describe, expect, it } from "vitest";
import { loadUserPreferences, saveUserPreferences } from "./userPreferences";

const PREFS_KEY = "openscreen_user_preferences";

describe("userPreferences", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("uses recording-quality defaults when no preferences are saved", () => {
		expect(loadUserPreferences()).toEqual({
			padding: 0,
			aspectRatio: "native",
			exportQuality: "source",
			exportFormat: "mp4",
		});
	});

	it("upgrades the old decorative composition defaults", () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({
				padding: 50,
				aspectRatio: "16:9",
				exportQuality: "good",
				exportFormat: "gif",
			}),
		);

		expect(loadUserPreferences()).toEqual({
			padding: 0,
			aspectRatio: "native",
			exportQuality: "source",
			exportFormat: "gif",
		});
	});

	it("upgrades the old composition defaults even when source quality was already selected", () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({
				padding: 50,
				aspectRatio: "16:9",
				exportQuality: "source",
				exportFormat: "mp4",
			}),
		);

		expect(loadUserPreferences()).toEqual({
			padding: 0,
			aspectRatio: "native",
			exportQuality: "source",
			exportFormat: "mp4",
		});
	});

	it("preserves deliberate legacy composition choices", () => {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({
				padding: 18,
				aspectRatio: "16:10",
				exportQuality: "good",
				exportFormat: "mp4",
			}),
		);

		expect(loadUserPreferences()).toEqual({
			padding: 18,
			aspectRatio: "16:10",
			exportQuality: "good",
			exportFormat: "mp4",
		});
	});

	it("saves preferences with the current defaults version", () => {
		saveUserPreferences({ exportQuality: "source" });

		expect(JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}")).toMatchObject({
			padding: 0,
			aspectRatio: "native",
			exportQuality: "source",
			exportFormat: "mp4",
			defaultsVersion: 2,
		});
	});
});
