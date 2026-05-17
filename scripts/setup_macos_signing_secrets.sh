#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="LikaloLLC/docsie-screen-recorder"
DEFAULT_TEAM_ID="KQ433V54UU"
DEFAULT_CODESIGN_IDENTITY="Developer ID Application: Docsie Inc. (${DEFAULT_TEAM_ID})"
DEFAULT_CODESIGN_QUALIFIER="Docsie Inc. (${DEFAULT_TEAM_ID})"
DEFAULT_NOTARY_PROFILE="Docsie-notary"
DEFAULT_PRIVATE_KEY=".apple-signing/docsie-developer-id-application.key"
DEFAULT_GENERATED_P12=".apple-signing/docsie-developer-id-application.p12"

REPO="${GITHUB_REPOSITORY:-$DEFAULT_REPO}"
TEAM_ID="${APPLE_TEAM_ID:-$DEFAULT_TEAM_ID}"
CODESIGN_IDENTITY="${MAC_CODESIGN_IDENTITY:-$DEFAULT_CODESIGN_IDENTITY}"
CODESIGN_QUALIFIER="$DEFAULT_CODESIGN_QUALIFIER"
NOTARY_PROFILE="${NOTARY_PROFILE:-$DEFAULT_NOTARY_PROFILE}"
P12_PATH=""
CER_PATH=""
PRIVATE_KEY_PATH="$DEFAULT_PRIVATE_KEY"
APPLE_ID="${APPLE_ID:-}"
STORE_LOCAL_NOTARY=1
WRITE_ENV=1

usage() {
	cat <<'EOF'
Usage:
  npm run signing:setup -- --p12 /path/to/DeveloperIDApplication.p12 --apple-id you@example.com
  npm run signing:setup -- --cer /path/to/developerID_application.cer --apple-id you@example.com

Options:
  --repo OWNER/REPO              GitHub repo to write secrets to. Default: LikaloLLC/docsie-screen-recorder
  --p12 PATH                     Password-protected Developer ID Application .p12 export.
  --cer PATH                     Apple-issued Developer ID Application .cer to combine with a private key.
  --key PATH                     Private key used for the CSR. Default: .apple-signing/docsie-developer-id-application.key
  --apple-id EMAIL               Apple ID email used for notarization.
  --team-id TEAM_ID              Apple Developer Team ID. Default: KQ433V54UU
  --codesign-identity IDENTITY   Full Developer ID Application identity.
  --notary-profile NAME          Local notarytool keychain profile. Default: Docsie-notary
  --skip-local-notary            Do not store local notarytool credentials.
  --no-env                       Do not write the local .env helper file.
  -h, --help                     Show this help.

Required Apple-side prerequisites:
  1. Create a Developer ID Application certificate for Docsie Inc.
  2. Export it from Keychain Access as a password-protected .p12.
  3. Create an Apple app-specific password for notarization.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
		--repo)
			REPO="${2:-}"
			shift 2
			;;
		--p12)
			P12_PATH="${2:-}"
			shift 2
			;;
		--cer)
			CER_PATH="${2:-}"
			shift 2
			;;
		--key)
			PRIVATE_KEY_PATH="${2:-}"
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
		--codesign-identity)
			CODESIGN_IDENTITY="${2:-}"
			shift 2
			;;
		--notary-profile)
			NOTARY_PROFILE="${2:-}"
			shift 2
			;;
		--skip-local-notary)
			STORE_LOCAL_NOTARY=0
			shift
			;;
		--no-env)
			WRITE_ENV=0
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

if [[ "$CODESIGN_IDENTITY" == "$DEFAULT_CODESIGN_IDENTITY" && "$TEAM_ID" != "$DEFAULT_TEAM_ID" ]]; then
	CODESIGN_IDENTITY="Developer ID Application: Docsie Inc. (${TEAM_ID})"
	CODESIGN_QUALIFIER="Docsie Inc. (${TEAM_ID})"
else
	CODESIGN_QUALIFIER="$CODESIGN_IDENTITY"
	CODESIGN_QUALIFIER="${CODESIGN_QUALIFIER#Developer ID Application: }"
	CODESIGN_QUALIFIER="${CODESIGN_QUALIFIER#Developer ID Installer: }"
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

set_secret() {
	local name="$1"
	local value="$2"

	printf '%s' "$value" | gh secret set "$name" -R "$REPO" >/dev/null
	echo "Set GitHub secret: $name"
}

require_command gh
require_command base64
require_command openssl

gh auth status >/dev/null

if [[ -n "$P12_PATH" && -n "$CER_PATH" ]]; then
	echo "Pass either --p12 or --cer, not both." >&2
	exit 1
fi

if [[ -z "$P12_PATH" && -z "$CER_PATH" ]]; then
	P12_PATH="$(prompt_value "Path to exported Developer ID Application .p12, or leave empty to use Apple .cer" "")"
	if [[ -z "$P12_PATH" ]]; then
		CER_PATH="$(prompt_value "Path to Apple-issued Developer ID Application .cer" "")"
	fi
fi

if [[ -n "$P12_PATH" && ! -f "$P12_PATH" ]]; then
	echo "The .p12 file does not exist: $P12_PATH" >&2
	exit 1
fi

if [[ -n "$CER_PATH" && ! -f "$CER_PATH" ]]; then
	echo "The .cer file does not exist: $CER_PATH" >&2
	exit 1
fi

if [[ -n "$CER_PATH" && ! -f "$PRIVATE_KEY_PATH" ]]; then
	echo "The private key file does not exist: $PRIVATE_KEY_PATH" >&2
	exit 1
fi

APPLE_ID="$(prompt_value "Apple ID email for notarization" "$APPLE_ID")"

if [[ -z "$APPLE_ID" ]]; then
	echo "Apple ID email is required." >&2
	exit 1
fi

P12_PASSWORD="$(prompt_secret "Password used when exporting the .p12")"
APP_SPECIFIC_PASSWORD="$(prompt_secret "Apple app-specific password for notarization")"

if [[ -z "$P12_PASSWORD" || -z "$APP_SPECIFIC_PASSWORD" ]]; then
	echo "Both the .p12 password and Apple app-specific password are required." >&2
	exit 1
fi

if [[ -n "$CER_PATH" ]]; then
	mkdir -p "$(dirname "$DEFAULT_GENERATED_P12")"
	CERT_PEM="$(mktemp)"
	trap 'rm -f "$CERT_PEM"' EXIT

	if ! openssl x509 -in "$CER_PATH" -out "$CERT_PEM" >/dev/null 2>&1; then
		openssl x509 -inform DER -in "$CER_PATH" -out "$CERT_PEM" >/dev/null
	fi

	P12_PATH="$DEFAULT_GENERATED_P12"
	openssl pkcs12 -export \
		-inkey "$PRIVATE_KEY_PATH" \
		-in "$CERT_PEM" \
		-out "$P12_PATH" \
		-name "$CODESIGN_IDENTITY" \
		-passin "pass:$P12_PASSWORD" \
		-passout "pass:$P12_PASSWORD" >/dev/null
	chmod 600 "$P12_PATH"
	echo "Created GitHub Actions .p12 bundle: $P12_PATH"
fi

P12_BASE64="$(base64 < "$P12_PATH" | tr -d '\n')"

set_secret "MAC_CERTIFICATE_P12" "$P12_BASE64"
set_secret "MAC_CERTIFICATE_PASSWORD" "$P12_PASSWORD"
set_secret "MAC_CODESIGN_IDENTITY" "$CODESIGN_IDENTITY"
set_secret "APPLE_ID" "$APPLE_ID"
set_secret "APPLE_TEAM_ID" "$TEAM_ID"
set_secret "APPLE_APP_SPECIFIC_PASSWORD" "$APP_SPECIFIC_PASSWORD"

if [[ "$WRITE_ENV" == "1" ]]; then
	cat > .env <<EOF
APP_NAME="Docsie Screen Recorder"
APP_ARTIFACT_BASENAME=docsie-screen-recorder
BUNDLE_ID=io.docsie.screenrecorder

APPLE_ID=${APPLE_ID}
APPLE_TEAM_ID=${TEAM_ID}
TEAM_ID=${TEAM_ID}
SIGN_IDENTITY="${CODESIGN_IDENTITY}"
CSC_NAME="${CODESIGN_QUALIFIER}"

NOTARY_PROFILE=${NOTARY_PROFILE}
EOF
	chmod 600 .env
	echo "Wrote local .env with non-password signing metadata."
fi

if [[ "$STORE_LOCAL_NOTARY" == "1" ]]; then
	if [[ "$(uname)" != "Darwin" ]]; then
		echo "Skipping local notary profile because this is not macOS."
	elif ! command -v xcrun >/dev/null 2>&1; then
		echo "Skipping local notary profile because xcrun is unavailable."
	else
		xcrun notarytool store-credentials "$NOTARY_PROFILE" \
			--apple-id "$APPLE_ID" \
			--team-id "$TEAM_ID" \
			--password "$APP_SPECIFIC_PASSWORD"
		echo "Stored local notarytool profile: $NOTARY_PROFILE"
	fi
fi

cat <<EOF

macOS signing setup complete for $REPO.

Next release:
  npm run release:patch

Signed local build:
  RELEASE_SIGN_MACOS=1 npm run release:local
EOF
