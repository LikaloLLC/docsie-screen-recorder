#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

VERSION="$(node -p 'require("./package.json").version')"
PRODUCT_NAME="Docsie Screen Recorder"
TEAM_ID="${APPLE_TEAM_ID:-KQ433V54UU}"
CSC_NAME="${CSC_NAME:-Docsie Inc. (${TEAM_ID})}"
INSTALLER_IDENTITY="${MAS_INSTALLER_CODESIGN_IDENTITY:-3rd Party Mac Developer Installer: Docsie Inc. (${TEAM_ID})}"
MAS_ARCH="${MAS_ARCH:-universal}"
OUTPUT_ROOT="release/${VERSION}"

case "$MAS_ARCH" in
	universal)
		ARCH_FLAG="--universal"
		OUTPUT_DIR="${OUTPUT_ROOT}/mas-universal"
		PKG_ARCH="universal"
		;;
	arm64)
		ARCH_FLAG="--arm64"
		OUTPUT_DIR="${OUTPUT_ROOT}/mas-arm64"
		PKG_ARCH="arm64"
		;;
	x64)
		ARCH_FLAG="--x64"
		OUTPUT_DIR="${OUTPUT_ROOT}/mas"
		PKG_ARCH="x64"
		;;
	*)
		echo "Unsupported MAS_ARCH: ${MAS_ARCH}. Use universal, arm64, or x64." >&2
		exit 1
		;;
esac

rm -rf "$OUTPUT_DIR"

npm run build-vite

EXTRA_CONFIG=()
if [[ -f build/mas.provisionprofile ]]; then
	EXTRA_CONFIG=(-c.mas.provisioningProfile=build/mas.provisionprofile)
fi

PRODUCTBUILD_WRAPPER_DIR="$(mktemp -d)"
trap 'rm -rf "$PRODUCTBUILD_WRAPPER_DIR"' EXIT

cat > "${PRODUCTBUILD_WRAPPER_DIR}/productbuild" <<'EOF'
#!/usr/bin/env bash
exec /usr/bin/productbuild --timestamp=none "$@"
EOF
chmod +x "${PRODUCTBUILD_WRAPPER_DIR}/productbuild"

if [[ ${#EXTRA_CONFIG[@]} -gt 0 ]]; then
	PATH="${PRODUCTBUILD_WRAPPER_DIR}:$PATH" CSC_NAME="$CSC_NAME" npx electron-builder --mac mas "$ARCH_FLAG" "${EXTRA_CONFIG[@]}"
else
	PATH="${PRODUCTBUILD_WRAPPER_DIR}:$PATH" CSC_NAME="$CSC_NAME" npx electron-builder --mac mas "$ARCH_FLAG"
fi

APP_BUNDLE="${OUTPUT_DIR}/${PRODUCT_NAME}.app"
PKG_OUTPUT="${OUTPUT_DIR}/${PRODUCT_NAME}-Mac-App-Store-${PKG_ARCH}-${VERSION}.pkg"

if [[ ! -d "$APP_BUNDLE" ]]; then
	echo "Could not find MAS app bundle: $APP_BUNDLE" >&2
	exit 1
fi

pkgutil --check-signature "$PKG_OUTPUT"

echo "Mac App Store package created: $PKG_OUTPUT"
