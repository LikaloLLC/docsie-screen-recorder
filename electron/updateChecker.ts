import fs from "node:fs/promises";
import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";

const RELEASES_API_URL =
	"https://api.github.com/repos/LikaloLLC/docsie-screen-recorder/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/LikaloLLC/docsie-screen-recorder/releases/latest";
const UPDATE_STATE_PATH = path.join(app.getPath("userData"), "update-check.json");
const REQUEST_TIMEOUT_MS = 8000;

interface GitHubReleaseAsset {
	name?: unknown;
	browser_download_url?: unknown;
}

interface GitHubRelease {
	tag_name?: unknown;
	name?: unknown;
	html_url?: unknown;
	body?: unknown;
	assets?: unknown;
}

interface UpdateCheckState {
	skippedVersion?: string;
}

interface UpdateInfo {
	version: string;
	name: string;
	pageUrl: string;
	downloadUrl: string;
}

function showNativeMessageBox(
	parent: BrowserWindow | undefined,
	options: Electron.MessageBoxOptions,
) {
	return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function normalizeVersion(value: string) {
	return value.trim().replace(/^v/i, "");
}

function parseVersion(value: string) {
	return normalizeVersion(value)
		.split(/[.-]/)
		.map((part) => Number.parseInt(part, 10))
		.map((part) => (Number.isFinite(part) ? part : 0));
}

function isNewerVersion(candidate: string, current: string) {
	const candidateParts = parseVersion(candidate);
	const currentParts = parseVersion(current);
	const length = Math.max(candidateParts.length, currentParts.length);

	for (let index = 0; index < length; index += 1) {
		const next = candidateParts[index] ?? 0;
		const installed = currentParts[index] ?? 0;
		if (next > installed) {
			return true;
		}
		if (next < installed) {
			return false;
		}
	}

	return false;
}

function getPreferredAssetName() {
	if (process.platform === "darwin") {
		return process.arch === "arm64"
			? "docsie-screen-recorder-mac-arm64.dmg"
			: "docsie-screen-recorder-mac-x64.dmg";
	}

	if (process.platform === "win32") {
		return "Docsie.Screen.Recorder.Setup.exe";
	}

	if (process.platform === "linux") {
		return "Docsie.Screen.Recorder-Linux.AppImage";
	}

	return null;
}

function asString(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getPreferredDownloadUrl(release: GitHubRelease) {
	const preferredAssetName = getPreferredAssetName();
	const assets = Array.isArray(release.assets) ? release.assets : [];

	if (preferredAssetName) {
		for (const asset of assets) {
			const entry = asset as GitHubReleaseAsset;
			if (asString(entry.name) === preferredAssetName) {
				return asString(entry.browser_download_url);
			}
		}
	}

	return asString(release.html_url) ?? RELEASES_PAGE_URL;
}

async function readUpdateCheckState(): Promise<UpdateCheckState> {
	try {
		const raw = await fs.readFile(UPDATE_STATE_PATH, "utf-8");
		const parsed = JSON.parse(raw) as UpdateCheckState;
		return {
			skippedVersion: asString(parsed.skippedVersion) ?? undefined,
		};
	} catch {
		return {};
	}
}

async function writeUpdateCheckState(state: UpdateCheckState) {
	await fs.writeFile(UPDATE_STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
	const abortController = new AbortController();
	const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

	try {
		const response = await fetch(RELEASES_API_URL, {
			headers: {
				Accept: "application/vnd.github+json",
				"User-Agent": "Docsie-Screen-Recorder",
			},
			signal: abortController.signal,
		});

		if (!response.ok) {
			throw new Error(`GitHub release check failed with ${response.status}`);
		}

		return (await response.json()) as GitHubRelease;
	} finally {
		clearTimeout(timeoutId);
	}
}

async function getAvailableUpdate(): Promise<UpdateInfo | null> {
	const release = await fetchLatestRelease();
	const tagName = asString(release.tag_name);
	if (!tagName) {
		return null;
	}

	const latestVersion = normalizeVersion(tagName);
	if (!isNewerVersion(latestVersion, app.getVersion())) {
		return null;
	}

	return {
		version: latestVersion,
		name: asString(release.name) ?? `Docsie Screen Recorder ${latestVersion}`,
		pageUrl: asString(release.html_url) ?? RELEASES_PAGE_URL,
		downloadUrl: getPreferredDownloadUrl(release) ?? RELEASES_PAGE_URL,
	};
}

export async function checkForUpdates(options?: {
	manual?: boolean;
	parent?: BrowserWindow | null;
}) {
	try {
		const update = await getAvailableUpdate();
		if (!update) {
			if (options?.manual) {
				const parent = options.parent && !options.parent.isDestroyed() ? options.parent : undefined;
				await showNativeMessageBox(parent, {
					type: "info",
					title: "Docsie Screen Recorder is up to date",
					message: "You are using the latest version.",
					detail: `Installed version: ${app.getVersion()}`,
					buttons: ["OK"],
				});
			}
			return;
		}

		const state = await readUpdateCheckState();
		if (!options?.manual && state.skippedVersion === update.version) {
			return;
		}

		const parent = options?.parent && !options.parent.isDestroyed() ? options.parent : undefined;
		const result = await showNativeMessageBox(parent, {
			type: "info",
			title: "Update available",
			message: `Docsie Screen Recorder ${update.version} is available.`,
			detail: `Installed version: ${app.getVersion()}\nLatest release: ${update.name}`,
			buttons: ["Download", "Later", "Skip This Version"],
			defaultId: 0,
			cancelId: 1,
		});

		if (result.response === 0) {
			await writeUpdateCheckState({});
			await shell.openExternal(update.downloadUrl || update.pageUrl);
			return;
		}

		if (result.response === 2) {
			await writeUpdateCheckState({ skippedVersion: update.version });
		}
	} catch (error) {
		console.warn("Failed to check for updates:", error);
		if (options?.manual) {
			const parent = options.parent && !options.parent.isDestroyed() ? options.parent : undefined;
			await showNativeMessageBox(parent, {
				type: "warning",
				title: "Update check failed",
				message: "Docsie Screen Recorder could not check for updates.",
				detail: error instanceof Error ? error.message : String(error),
				buttons: ["OK"],
			});
		}
	}
}
