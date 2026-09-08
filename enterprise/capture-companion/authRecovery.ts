// SPDX-FileCopyrightText: 2026 Likalo LLC
// SPDX-License-Identifier: LicenseRef-Docsie-Capture-Companion-Enterprise-1.0

const AUTHENTICATION_LANGUAGE =
	/(auth(?:entication|orization)?|credentials?|token|unauthenticated|not authenticated|session)/i;

export function isDocsieAuthenticationError(message: string): boolean {
	const normalized = message.trim();
	if (!normalized) {
		return false;
	}

	if (/\b401\b/.test(normalized)) {
		return true;
	}

	if (/\b403\b/.test(normalized) && AUTHENTICATION_LANGUAGE.test(normalized)) {
		return true;
	}

	return /authentication credentials were not provided|api token is not configured|invalid token|token (?:has )?expired/i.test(
		normalized,
	);
}
