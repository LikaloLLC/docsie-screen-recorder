#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

ACTION="${1:-validate}"
VERSION="$(node -p 'require("./package.json").version')"
PRODUCT_NAME="Docsie Screen Recorder"
MAS_ARCH="${MAS_ARCH:-universal}"

case "$MAS_ARCH" in
	universal)
		DEFAULT_PKG="release/${VERSION}/mas-universal/${PRODUCT_NAME}-Mac-App-Store-universal-${VERSION}.pkg"
		;;
	arm64)
		DEFAULT_PKG="release/${VERSION}/mas-arm64/${PRODUCT_NAME}-Mac-App-Store-arm64-${VERSION}.pkg"
		;;
	x64)
		DEFAULT_PKG="release/${VERSION}/mas/${PRODUCT_NAME}-Mac-App-Store-x64-${VERSION}.pkg"
		;;
	*)
		echo "Unsupported MAS_ARCH: ${MAS_ARCH}. Use universal, arm64, or x64." >&2
		exit 1
		;;
esac

PKG_PATH="${2:-${MAS_PKG_PATH:-$DEFAULT_PKG}}"
APPLE_ID="${APPLE_ID:-}"
PASSWORD_REF="${ALTOOL_PASSWORD_REF:-}"

if [[ "$ACTION" != "validate" && "$ACTION" != "upload" ]]; then
	echo "Usage: npm run mas:validate|mas:upload [-- /path/to/pkg]" >&2
	exit 1
fi

if [[ ! -f "$PKG_PATH" ]]; then
	echo "Package not found: $PKG_PATH" >&2
	echo "Run npm run build:mas first, or pass a package path." >&2
	exit 1
fi

if [[ -z "$APPLE_ID" ]]; then
	echo "APPLE_ID is required." >&2
	exit 1
fi

if [[ -z "$PASSWORD_REF" ]]; then
	if [[ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]]; then
		PASSWORD_REF="@env:APPLE_APP_SPECIFIC_PASSWORD"
	else
		echo "Set APPLE_APP_SPECIFIC_PASSWORD or ALTOOL_PASSWORD_REF." >&2
		echo "Example: ALTOOL_PASSWORD_REF='@keychain:DocsieAppStoreConnect' npm run mas:upload" >&2
		exit 1
	fi
fi

if [[ "$ACTION" == "validate" ]]; then
	xcrun altool --validate-app \
		-f "$PKG_PATH" \
		-t macos \
		-u "$APPLE_ID" \
		-p "$PASSWORD_REF" \
		--output-format normal
else
	xcrun altool --upload-app \
		-f "$PKG_PATH" \
		-t macos \
		-u "$APPLE_ID" \
		-p "$PASSWORD_REF" \
		--output-format normal \
		--show-progress
fi
