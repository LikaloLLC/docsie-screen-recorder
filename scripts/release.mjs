#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(projectRoot, "package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const version = packageJson.version;
const defaultTag = `v${version}`;
const isWindows = process.platform === "win32";
const npmCommand = isWindows ? "npm.cmd" : "npm";
const npxCommand = isWindows ? "npx.cmd" : "npx";

function log(message) {
	process.stdout.write(`${message}\n`);
}

function fail(message) {
	process.stderr.write(`${message}\n`);
	process.exit(1);
}

function usage(exitCode = 0) {
	const message = `
Usage:
  npm run release:local
  npm run release:tag -- [tag] [--remote origin] [--allow-dirty] [--allow-version-mismatch]

Commands:
  local   Build release binaries for the current OS only.
  tag     Create and push a git tag that triggers the GitHub Actions release workflow.

Notes:
  - Cross-platform Windows/Linux/macOS releases are built in GitHub Actions on native runners.
  - The default tag is ${defaultTag} and must match package.json unless --allow-version-mismatch is set.
  - Set RELEASE_SIGN_MACOS=1 with the local command to use scripts/build_macos.sh on macOS.
`.trim();

	process.stdout.write(`${message}\n`);
	process.exit(exitCode);
}

function run(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		stdio: "inherit",
		...options,
	});

	if (result.error) {
		fail(`Failed to run ${command}: ${result.error.message}`);
	}

	if (result.status !== 0) {
		fail(`${command} ${args.join(" ")} exited with code ${result.status}`);
	}
}

function capture(command, args, options = {}) {
	const result = spawnSync(command, args, {
		cwd: projectRoot,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	});

	if (result.error) {
		fail(`Failed to run ${command}: ${result.error.message}`);
	}

	if (result.status !== 0) {
		const stderr = result.stderr?.trim();
		fail(stderr ? stderr : `${command} ${args.join(" ")} exited with code ${result.status}`);
	}

	return result.stdout.trim();
}

function parseTagOptions(args) {
	const options = {
		tag: defaultTag,
		remote: "origin",
		allowDirty: false,
		allowVersionMismatch: false,
	};

	for (let index = 0; index < args.length; index += 1) {
		const value = args[index];

		if (!value) {
			continue;
		}

		if (!value.startsWith("--") && options.tag === defaultTag) {
			options.tag = value;
			continue;
		}

		if (value === "--remote") {
			const remote = args[index + 1];
			if (!remote) {
				fail("--remote requires a value");
			}
			options.remote = remote;
			index += 1;
			continue;
		}

		if (value === "--allow-dirty") {
			options.allowDirty = true;
			continue;
		}

		if (value === "--allow-version-mismatch") {
			options.allowVersionMismatch = true;
			continue;
		}

		if (value === "--help" || value === "-h") {
			usage(0);
		}

		fail(`Unknown option: ${value}`);
	}

	return options;
}

function ensureCleanWorktree() {
	const status = capture("git", ["status", "--short"]);
	if (status.length > 0) {
		fail("Refusing to tag a dirty worktree. Commit or stash your changes first, or rerun with --allow-dirty.");
	}
}

function ensureVersionMatch(tag, allowVersionMismatch) {
	if (allowVersionMismatch || tag === defaultTag) {
		return;
	}

	fail(
		`Tag ${tag} does not match package.json version ${version}. Bump package.json first or rerun with --allow-version-mismatch.`,
	);
}

function ensureTagDoesNotExist(tag, remote) {
	const localTags = capture("git", ["tag", "--list", tag]);
	if (localTags === tag) {
		fail(`Tag ${tag} already exists locally.`);
	}

	const remoteTags = capture("git", ["ls-remote", "--tags", remote, tag]);
	if (remoteTags.length > 0) {
		fail(`Tag ${tag} already exists on ${remote}.`);
	}
}

function buildCurrentPlatform() {
	log(`Building release binaries for ${process.platform} ${process.arch}`);

	if (process.platform === "darwin" && process.env.RELEASE_SIGN_MACOS === "1") {
		run("bash", [path.join(projectRoot, "scripts", "build_macos.sh")]);
		log(`Signed macOS artifacts are available in ${path.join(projectRoot, "release", version)}`);
		return;
	}

	run(npmCommand, ["ci"]);
	run(npxCommand, ["electron-builder", "install-app-deps"]);

	if (process.platform === "darwin") {
		run(npmCommand, ["run", "build:mac"]);
	} else if (process.platform === "win32") {
		run(npmCommand, ["run", "build:win"]);
	} else if (process.platform === "linux") {
		run(npmCommand, ["run", "build:linux"]);
	} else {
		fail(`Unsupported platform: ${process.platform}`);
	}

	log(`Artifacts are available in ${path.join(projectRoot, "release", version)}`);
}

function tagRelease(args) {
	const options = parseTagOptions(args);

	if (!options.allowDirty) {
		ensureCleanWorktree();
	}

	ensureVersionMatch(options.tag, options.allowVersionMismatch);
	ensureTagDoesNotExist(options.tag, options.remote);

	run("git", ["tag", "-a", options.tag, "-m", `Release ${options.tag}`]);
	run("git", ["push", options.remote, options.tag]);

	log(`Pushed ${options.tag} to ${options.remote}.`);
	log("GitHub Actions will now build Windows, Linux, and macOS release binaries on native runners.");
	log("GitHub Releases publishing is automatic on tag pushes. Use the workflow dispatch UI when you need an S3 mirror.");
}

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
	usage(command ? 0 : 1);
}

if (command === "local") {
	if (args.includes("--help") || args.includes("-h")) {
		usage(0);
	}

	if (args.length > 0) {
		fail("The local command does not accept additional arguments.");
	}

	buildCurrentPlatform();
	process.exit(0);
}

if (command === "tag") {
	tagRelease(args);
	process.exit(0);
}

fail(`Unknown command: ${command}`);
