# Releasing

This repo now has a native-runner release pipeline for all desktop targets:

- Windows: NSIS installer on `windows-latest`
- Linux: `AppImage` and `deb` on `ubuntu-latest`
- macOS: DMG on `macos-latest`

GitHub Releases is the default distribution target. S3 is supported as an optional mirror.

## Normal Flow

For routine releases, let the release helper bump the app version and create a fresh tag:

```bash
npm run release:patch
```

That command:

1. Requires a clean git worktree.
2. Bumps `package.json` and `package-lock.json`.
3. Commits the version bump.
4. Pushes the current branch.
5. Creates and pushes `v<new version>`.

The tag push triggers `.github/workflows/release.yml`, which builds the installers on native GitHub-hosted runners and publishes them to the GitHub release for that tag.

Use these when the version change should be larger:

```bash
npm run release:minor
npm run release:major
```

If you already bumped `package.json` manually, run:

```bash
npm run release:tag
```

That creates and pushes `v<package.json version>`.

If `release-notes/v<version>.md` exists, the workflow uses it as the GitHub release description. Otherwise, GitHub generates release notes from commits.

## Local Build Only

If you just want to build the current platform without publishing:

```bash
npm run release:local
```

Notes:

- On macOS, `npm run release:local` uses `npm run build:mac` by default.
- If you want the existing signed/notarized local mac flow, run:

```bash
RELEASE_SIGN_MACOS=1 npm run release:local
```

That delegates to [`scripts/build_macos.sh`](./scripts/build_macos.sh).

## Workflow Dispatch

Use the GitHub Actions UI for `.github/workflows/release.yml` when you need to:

- rerun a release without creating a new tag
- publish to S3 only
- publish to both GitHub Releases and S3
- limit the mac build to `arm64` or `x64`

Inputs:

- `release_tag`: tag like `v1.3.0`
- `publish_target`: `github`, `s3`, `both`, or `none`
- `mac_arch`: `both`, `arm64`, or `x64`

The workflow validates that `package.json` matches the requested tag version before it builds anything.

## Required GitHub Secrets

GitHub Releases:

- none beyond the default `GITHUB_TOKEN`

macOS signing/notarization:

- `MAC_CERTIFICATE_P12`: base64-encoded Developer ID `.p12`
- `MAC_CERTIFICATE_PASSWORD`
- `MAC_CODESIGN_IDENTITY`: full signing identity string. Defaults to `Developer ID Application: Docsie Inc. (KQ433V54UU)` when omitted.
- `APPLE_ID`
- `APPLE_TEAM_ID`: Docsie team ID. Defaults to `KQ433V54UU` when omitted.
- `APPLE_APP_SPECIFIC_PASSWORD`

Published releases require signed and notarized macOS DMGs. If those macOS secrets are missing, `.github/workflows/release.yml` fails before publishing. Use `publish_target: none` or the manual build workflow only when you intentionally need unsigned test artifacts.

## macOS Signing Setup

Use the Docsie Apple Developer organization account to create a `Developer ID Application` certificate, then export it from Keychain Access as a password-protected `.p12`.

Convert the exported certificate for GitHub Actions:

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

Add the copied value as `MAC_CERTIFICATE_P12`, add the export password as `MAC_CERTIFICATE_PASSWORD`, and add the Apple account email plus an app-specific password as `APPLE_ID` and `APPLE_APP_SPECIFIC_PASSWORD`.

You can also let the setup helper write all GitHub secrets and the local notary profile:

```bash
npm run signing:setup -- --p12 /path/to/DeveloperIDApplication.p12 --apple-id "<apple-id>"
```

The helper prompts for the `.p12` export password and Apple app-specific password without echoing them.

The default signing metadata is:

```text
APPLE_TEAM_ID=KQ433V54UU
MAC_CODESIGN_IDENTITY=Developer ID Application: Docsie Inc. (KQ433V54UU)
```

Set those explicitly as GitHub secrets if the certificate common name differs from the default.

For a signed local macOS build, copy `.env.example` to `.env`, fill in `APPLE_ID`, then store notary credentials once:

```bash
xcrun notarytool store-credentials "Docsie-notary" \
  --apple-id "<apple-id>" \
  --team-id "KQ433V54UU" \
  --password "<app-specific-password>"
```

Then run:

```bash
RELEASE_SIGN_MACOS=1 npm run release:local
```

## Mac App Store Setup

The Mac App Store path is separate from the signed DMG release path. It uses Apple App Store certificates and produces a `.pkg` for App Store Connect.

Create these Apple certificates:

- `Mac App Distribution`
- `Mac Installer Distribution`

When Apple asks for CSRs, use:

```text
.apple-signing/docsie-mac-app-distribution.certSigningRequest
.apple-signing/docsie-mac-installer-distribution.certSigningRequest
```

After downloading both `.cer` files, run:

```bash
npm run signing:setup:mas -- \
  --app-cer /path/to/mac_app.cer \
  --installer-cer /path/to/mac_installer.cer \
  --apple-id "<apple-id>"
```

Build the App Store package locally:

```bash
npm run build:mas
```

The output package is:

```text
release/<version>/mas-arm64/Docsie Screen Recorder-Mac-App-Store-arm64-<version>.pkg
```

App Store builds do not use notarization. App Store Connect performs its own validation after upload.

Before uploading the first build, create the macOS app record in App Store Connect with bundle ID `io.docsie.screenrecorder`.

Validate or upload the package from the command line:

```bash
APPLE_ID="<apple-id>" APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>" npm run mas:validate
APPLE_ID="<apple-id>" APPLE_APP_SPECIFIC_PASSWORD="<app-specific-password>" npm run mas:upload
```

To keep the app-specific password out of shell history, store it in Keychain and use `ALTOOL_PASSWORD_REF`:

```bash
xcrun altool --store-password-in-keychain-item DocsieAppStoreConnect -u "<apple-id>" -p "<app-specific-password>"
APPLE_ID="<apple-id>" ALTOOL_PASSWORD_REF="@keychain:DocsieAppStoreConnect" npm run mas:upload
```

You can also run `.github/workflows/mac-app-store.yml` manually. Leave `upload_to_app_store` disabled to only produce a package artifact, or enable it after the App Store Connect app record exists.

Optional S3 publish:

- Preferred auth: `AWS_ROLE_TO_ASSUME`
- Fallback auth: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
- Repo variable: `AWS_REGION`
- Repo variable: `RELEASE_S3_BUCKET`
- Optional repo variable: `RELEASE_S3_PREFIX`

When S3 publishing is enabled, assets are uploaded to:

```text
s3://<RELEASE_S3_BUCKET>/<RELEASE_S3_PREFIX>/<release_tag>/
```

If `RELEASE_S3_PREFIX` is empty, the prefix segment is omitted.

## Output

The release workflow uploads these artifacts:

- Windows `.exe`
- Linux `.AppImage`
- Linux `.deb`
- Linux `.zsync` when generated by electron-builder
- macOS `.dmg` for each requested architecture
- `SHA256SUMS.txt`
