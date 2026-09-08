// SPDX-FileCopyrightText: 2026 Likalo LLC
// SPDX-License-Identifier: LicenseRef-Docsie-Capture-Companion-Enterprise-1.0

import { describe, expect, it } from "vitest";
import { isDocsieAuthenticationError } from "./authRecovery";

describe("isDocsieAuthenticationError", () => {
	it.each([
		"Docsie request failed (401)",
		"Docsie request failed (403): Authentication credentials were not provided.",
		"API token is not configured",
		"The token has expired",
	])("recognizes an authentication failure: %s", (message) => {
		expect(isDocsieAuthenticationError(message)).toBe(true);
	});

	it.each([
		"Docsie request failed (403): You do not have access to this workspace.",
		"Docsie request failed (500): Internal server error",
		"Failed to upload media to Docsie storage",
	])("does not misclassify a non-authentication failure: %s", (message) => {
		expect(isDocsieAuthenticationError(message)).toBe(false);
	});
});
