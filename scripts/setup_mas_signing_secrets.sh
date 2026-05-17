#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="LikaloLLC/docsie-screen-recorder"
DEFAULT_TEAM_ID="KQ433V54UU"
DEFAULT_CODESIGN_QUALIFIER="Docsie Inc. (${DEFAULT_TEAM_ID})"
DEFAULT_APP_IDENTITY="3rd Party Mac Developer Application: Docsie Inc. (${DEFAULT_TEAM_ID})"
DEFAULT_INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Docsie Inc. (${DEFAULT_TEAM_ID})"
DEFAULT_APP_KEY=".apple-signing/docsie-mac-app-distribution.key"
DEFAULT_INSTALLER_KEY=".apple-signing/docsie-mac-installer-distribution.key"
DEFAULT_APP_P12=".apple-signing/docsie-mac-app-distribution.p12"
DEFAULT_INSTALLER_P12=".apple-signing/docsie-mac-installer-distribution.p12"
DEFAULT_WWDR_CERT=".apple-signing/AppleWWDRCAG3.cer"

REPO="${GITHUB_REPOSITORY:-$DEFAULT_REPO}"
TEAM_ID="${APPLE_TEAM_ID:-$DEFAULT_TEAM_ID}"
MAS_CODESIGN_QUALIFIER="${MAS_CODESIGN_QUALIFIER:-$DEFAULT_CODESIGN_QUALIFIER}"
APP_IDENTITY="${MAS_APP_CODESIGN_IDENTITY:-$DEFAULT_APP_IDENTITY}"
INSTALLER_IDENTITY="${MAS_INSTALLER_CODESIGN_IDENTITY:-$DEFAULT_INSTALLER_IDENTITY}"
APP_CER_PATH=""
INSTALLER_CER_PATH=""
APP_KEY_PATH="$DEFAULT_APP_KEY"
INSTALLER_KEY_PATH="$DEFAULT_INSTALLER_KEY"
APPLE_ID="${APPLE_ID:-}"
IMPORT_LOCAL=1

usage() {
	cat <<'EOF'
Usage:
  npm run signing:setup:mas -- \
    --app-cer /path/to/mac_app_distribution.cer \
    --installer-cer /path/to/mac_installer_distribution.cer \
    --apple-id you@example.com

Options:
  --repo OWNER/REPO              GitHub repo to write secrets to. Default: LikaloLLC/docsie-screen-recorder
  --app-cer PATH                 Apple-issued Mac App Distribution .cer.
  --installer-cer PATH           Apple-issued Mac Installer Distribution .cer.
  --app-key PATH                 Private key used for the Mac App Distribution CSR.
  --installer-key PATH           Private key used for the Mac Installer Distribution CSR.
  --apple-id EMAIL               Apple ID email used for App Store Connect / Transporter.
  --team-id TEAM_ID              Apple Developer Team ID. Default: KQ433V54UU
  --skip-local-import            Do not import the generated .p12 files into the local keychain.
  -h, --help                     Show this help.

Required Apple-side prerequisites:
  1. Create a Mac App Distribution certificate using .apple-signing/docsie-mac-app-distribution.certSigningRequest.
  2. Create a Mac Installer Distribution certificate using .apple-signing/docsie-mac-installer-distribution.certSigningRequest.
  3. Create an Apple app-specific password if you want CI upload automation later.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--repo)
			REPO="${2:-}"
			shift 2
			;;
		--app-cer)
			APP_CER_PATH="${2:-}"
			shift 2
			;;
		--installer-cer)
			INSTALLER_CER_PATH="${2:-}"
			shift 2
			;;
		--app-key)
			APP_KEY_PATH="${2:-}"
			shift 2
			;;
		--installer-key)
			INSTALLER_KEY_PATH="${2:-}"
			shift 2
			;;
		--apple-id)
			APPLE_ID="${2:-}"
			shift 2
			;;
		--team-id)
			TEAM_ID="${2:-}"
			shift 2
			;;
		--skip-local-import)
			IMPORT_LOCAL=0
			shift
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			echo "Unknown option: $1" >&2
			usage >&2
			exit 1
			;;
	esac
done

if [[ "$APP_IDENTITY" == "$DEFAULT_APP_IDENTITY" && "$TEAM_ID" != "$DEFAULT_TEAM_ID" ]]; then
	MAS_CODESIGN_QUALIFIER="Docsie Inc. (${TEAM_ID})"
	APP_IDENTITY="3rd Party Mac Developer Application: Docsie Inc. (${TEAM_ID})"
fi

if [[ "$INSTALLER_IDENTITY" == "$DEFAULT_INSTALLER_IDENTITY" && "$TEAM_ID" != "$DEFAULT_TEAM_ID" ]]; then
	INSTALLER_IDENTITY="3rd Party Mac Developer Installer: Docsie Inc. (${TEAM_ID})"
fi

require_command() {
	if ! command -v "$1" >/dev/null 2>&1; then
		echo "Missing required command: $1" >&2
		exit 1
	fi
}

prompt_value() {
	local label="$1"
	local current="$2"
	local value

	if [[ -n "$current" ]]; then
		printf '%s' "$current"
		return
	fi

	read -r -p "$label: " value
	printf '%s' "$value"
}

prompt_secret() {
	local label="$1"
	local value

	read -r -s -p "$label: " value
	echo >&2
	printf '%s' "$value"
}

convert_to_p12() {
	local cer_path="$1"
	local key_path="$2"
	local p12_path="$3"
	local identity="$4"
	local password="$5"
	local cert_pem

	cert_pem="$(mktemp)"
	if ! openssl x509 -in "$cer_path" -out "$cert_pem" >/dev/null 2>&1; then
		openssl x509 -inform DER -in "$cer_path" -out "$cert_pem" >/dev/null
	fi

	openssl pkcs12 -export -legacy \
		-inkey "$key_path" \
		-in "$cert_pem" \
		-certfile "$DEFAULT_WWDR_CERT" \
		-out "$p12_path" \
		-name "$identity" \
		-passout "pass:$password" >/dev/null

	rm -f "$cert_pem"
	chmod 600 "$p12_path"
}

set_secret() {
	local name="$1"
	local value="$2"

	printf '%s' "$value" | gh secret set "$name" -R "$REPO" >/dev/null
	echo "Set GitHub secret: $name"
}

require_command gh
require_command base64
require_command openssl
require_command curl

gh auth status >/dev/null

APP_CER_PATH="$(prompt_value "Path to Apple-issued Mac App Distribution .cer" "$APP_CER_PATH")"
INSTALLER_CER_PATH="$(prompt_value "Path to Apple-issued Mac Installer Distribution .cer" "$INSTALLER_CER_PATH")"
APPLE_ID="$(prompt_value "Apple ID email" "$APPLE_ID")"

if [[ ! -f "$APP_CER_PATH" ]]; then
	echo "The Mac App Distribution .cer does not exist: $APP_CER_PATH" >&2
	exit 1
fi

if [[ ! -f "$INSTALLER_CER_PATH" ]]; then
	echo "The Mac Installer Distribution .cer does not exist: $INSTALLER_CER_PATH" >&2
	exit 1
fi

if [[ ! -f "$APP_KEY_PATH" ]]; then
	echo "The Mac App Distribution private key does not exist: $APP_KEY_PATH" >&2
	exit 1
fi

if [[ ! -f "$INSTALLER_KEY_PATH" ]]; then
	echo "The Mac Installer Distribution private key does not exist: $INSTALLER_KEY_PATH" >&2
	exit 1
fi

if [[ -z "$APPLE_ID" ]]; then
	echo "Apple ID email is required." >&2
	exit 1
fi

P12_PASSWORD="$(prompt_secret "Password to protect the generated .p12 files")"
APP_SPECIFIC_PASSWORD="$(prompt_secret "Apple app-specific password for App Store Connect / Transporter")"

if [[ -z "$P12_PASSWORD" || -z "$APP_SPECIFIC_PASSWORD" ]]; then
	echo "Both the .p12 password and Apple app-specific password are required." >&2
	exit 1
fi

mkdir -p .apple-signing
if [[ ! -f "$DEFAULT_WWDR_CERT" ]]; then
	curl -fsSL https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer -o "$DEFAULT_WWDR_CERT"
fi

convert_to_p12 "$APP_CER_PATH" "$APP_KEY_PATH" "$DEFAULT_APP_P12" "$APP_IDENTITY" "$P12_PASSWORD"
convert_to_p12 "$INSTALLER_CER_PATH" "$INSTALLER_KEY_PATH" "$DEFAULT_INSTALLER_P12" "$INSTALLER_IDENTITY" "$P12_PASSWORD"

set_secret "MAS_APP_CERTIFICATE_P12" "$(base64 < "$DEFAULT_APP_P12" | tr -d '\n')"
set_secret "MAS_INSTALLER_CERTIFICATE_P12" "$(base64 < "$DEFAULT_INSTALLER_P12" | tr -d '\n')"
set_secret "MAS_CERTIFICATE_PASSWORD" "$P12_PASSWORD"
set_secret "MAS_CODESIGN_QUALIFIER" "$MAS_CODESIGN_QUALIFIER"
set_secret "MAS_APP_CODESIGN_IDENTITY" "$APP_IDENTITY"
set_secret "MAS_INSTALLER_CODESIGN_IDENTITY" "$INSTALLER_IDENTITY"
set_secret "APPLE_ID" "$APPLE_ID"
set_secret "APPLE_TEAM_ID" "$TEAM_ID"
set_secret "APPLE_APP_SPECIFIC_PASSWORD" "$APP_SPECIFIC_PASSWORD"

if [[ "$IMPORT_LOCAL" == "1" ]]; then
	if [[ "$(uname)" != "Darwin" ]]; then
		echo "Skipping local keychain import because this is not macOS."
	else
		security import "$DEFAULT_APP_P12" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
		security import "$DEFAULT_INSTALLER_P12" -P "$P12_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
		echo "Imported MAS certificates into the local keychain."
	fi
fi

cat <<EOF

Mac App Store signing setup complete for $REPO.

Build a local App Store package:
  npm run build:mas

The output package is for App Store Connect upload, not direct end-user installation.
EOF
