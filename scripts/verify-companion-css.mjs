#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const cssDirectory = path.resolve(scriptDir, "../dist/assets");
const cssFiles = readdirSync(cssDirectory).filter((file) => file.endsWith(".css"));

if (cssFiles.length === 0) {
	throw new Error(`No production CSS files found in ${cssDirectory}`);
}

const productionCss = cssFiles
	.map((file) => readFileSync(path.join(cssDirectory, file), "utf8"))
	.join("\n");

const requiredCompanionSelectors = [
	["dark application shell", ".bg-\\[\\#101014\\]"],
	["Docsie orange action", ".bg-\\[\\#FF6738\\]"],
	["language selector width", ".max-w-28"],
];

const missingSelectors = requiredCompanionSelectors.filter(
	([, selector]) => !productionCss.includes(selector),
);

if (missingSelectors.length > 0) {
	const labels = missingSelectors.map(([label]) => label).join(", ");
	throw new Error(
		`Capture Companion styles are missing from the production CSS: ${labels}. ` +
			"Check the enterprise source paths in tailwind.config.cjs.",
	);
}

process.stdout.write("Capture Companion production CSS verification passed.\n");
