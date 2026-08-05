# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Docsie Screen Recorder — an Electron + React desktop screen recorder and video editor, forked from [OpenScreen](https://github.com/siddharthvaddem/openscreen). Records screen/webcam/audio, edits on a timeline (zoom, trim, speed, annotations, blur, crop, webcam layout), exports MP4/GIF locally, and publishes recordings to Docsie's existing **Video-to-Docs** external API.

Boundary: all Docsie integration here is a **desktop client bridge**. The Docsie backend already exists and is consumed over its external API — no Django server code lives in this repo.

Node `22.22.1`, npm `10.9.4` (enforced via `engines`; `.nvmrc` present).

## Commands

```bash
npm run dev                # Vite dev server + Electron (vite-plugin-electron)
npm run lint               # biome check .
npm run lint:fix           # biome check --write .
npx tsc --noEmit           # typecheck (CI runs this; `npm run build` also typechecks)
npm run i18n:check         # key-parity check of all locales against `en`; exits 1 on drift
npm test                   # vitest --run (jsdom/node unit tests)
npm run test:watch
npm run test:browser       # real-Chromium tests (*.browser.test.ts) — export pipeline
npm run test:browser:install   # one-time: playwright install chromium-headless-shell
npm run test:e2e           # playwright, tests/e2e/
```

Single test file / single test:

```bash
npx vitest --run src/lib/compositeLayout.test.ts
npx vitest --run -t "clamps webcam size preset"
npx vitest --config vitest.browser.config.ts --run src/lib/exporter/gifExporter.browser.test.ts
```

Build / release:

```bash
npm run build              # tsc && vite build && electron-builder (current platform)
npm run build:mac | build:win | build:linux
npm run build:mas          # Mac App Store pkg
npm run release:patch      # bumps package.json, commits, pushes branch + tag -> GH Actions release
```

CI (`.github/workflows/ci.yml`) runs lint, `tsc --noEmit`, `test:browser`, and `vite build`. Note CI runs **`test:browser`, not `npm test`** — the jsdom suite is not gated in CI. Husky pre-commit runs `lint-staged` → biome on staged TS/JS/JSON.

Biome, not ESLint/Prettier: **tabs**, double quotes, line width 100, `recommended: false` with an explicit rule allowlist. Import organization is on via `assist`.

## Architecture

### Windows are one bundle, selected by query param

There is no router. Electron creates five `BrowserWindow`s that all load the same renderer bundle with a different `?windowType=`; `src/App.tsx:60-83` switches on it.

| `windowType` | Renders | Factory (`electron/windows.ts`) |
|---|---|---|
| `launch` / `hud-overlay` | `LaunchWindow` | `createLaunchWindow` |
| `editor` | `ShortcutsProvider` + `VideoEditor` | `createEditorWindow` |
| `source-selector` | `SourceSelector` | `createSourceSelectorWindow` |
| `countdown-overlay` | `CountdownOverlay` | `createCountdownOverlayWindow` |

`mainWindow` in `electron/main.ts` is a **single slot holding either the launch window or the editor window** — switching destroys one and creates the other. `isEditorWindow()` sniffs this by string-matching `windowType=editor` in the window URL, so changing how windows are loaded (e.g. query param → hash) silently breaks File-menu routing.

The editor window runs with `webSecurity: false` (needed to load `file://` media). Never load remote content there.

### Main process

Only 8 files in `electron/`. `electron/ipc/` has exactly two: `handlers.ts` (~1900 lines, nearly the whole IPC surface) and `docsie.ts` (~1900 lines, a pure Docsie API client with no `ipcMain` registration of its own).

`registerIpcHandlers(...)` takes **8 positional callbacks** (three window factories, three getters, `onRecordingStateChange`, `switchToHud`) — ordering is easy to get wrong.

Preload exposes exactly one global: `window.electronAPI` (`contextBridge.exposeInMainWorld`). Its type is declared **twice** — `electron/electron-env.d.ts` and `src/vite-env.d.ts` — and both must be kept in sync. All windows share the same preload, so every window sees the full API.

**Recording is streamed to disk, not buffered.** `begin-recording-session` truncates the target files; each `MediaRecorder` `dataavailable` chunk goes through `append-recording-chunk` and is appended via a per-asset promise chain (`asset.queue = asset.queue.then(() => fs.appendFile(...))`). `finish-recording-session` awaits all queues and writes a `.session.json` manifest. There are no temp files — chunks land directly in their final `.webm`, so a crash mid-recording leaves a partial file with no manifest.

Storage under `app.getPath("userData")`:
- `recordings/` — `recording-<id>.webm`, `-webcam.webm`, `-audio.webm`, `recording-<id>.session.json`, `recording-<id>.webm.cursor.json`
- `shortcuts.json`, `update-check.json`
- `docsie-integration.json` (bearer token; `safeStorage`-encrypted when available, **plaintext fallback** otherwise)
- `docsie-video-to-docs-history.json` (per-video result history, capped at 12), `docsie-voiceovers/`

**File reads go through a runtime path allowlist** (`approvedPaths`). Only `recordings/` is statically allowed; other paths get approved by file pickers, project loads (restricted to trusted dirs so a malicious `.docsiescreen` can't approve arbitrary reads), and recording session start. The set is **never persisted**, so after a restart an externally-picked video must be re-picked before it's readable.

**Cursor telemetry has no native module.** `screen.getCursorScreenPoint()` polled at 100 ms while recording, normalized 0–1 against the selected display's bounds — so window-mode recordings get screen-relative, not window-relative, coordinates.

macOS screen-capture permission cannot be prompted for. `getScreenCaptureAccessState()` reads `systemPreferences.getMediaAccessStatus("screen")` (returns granted unconditionally off-darwin); the UI deep-links to System Settings and offers `restart-app`, because the TCC grant only takes effect on relaunch.

### Renderer: editor state model

`useEditorHistory.ts` holds one undoable `EditorState`: `zoomRegions`, `trimRegions`, `speedRegions`, `annotationRegions`, `cropRegion`, `wallpaper`, `shadowIntensity`, `showBlur`, `motionBlurAmount`, `borderRadius`, `padding`, `aspectRatio`, webcam layout/mask/size/position, `voiceover`.

Deliberately **not** undoable, kept as plain `useState` in `VideoEditor.tsx`: the five selection IDs, playhead/`isPlaying`, media paths, export settings, dialog visibility, project path. (Export settings *are* persisted to the project file but sit outside history — undoing past an export-setting change won't revert it.)

The three-verb gesture protocol is the thing to get right — it's what stops a slider drag from creating 200 undo entries:

- `pushState(update)` — discrete edit (add/delete region, change depth). Always checkpoints.
- `updateState(update)` — continuous drag. Checkpoints only on the **first** call of a gesture, then mutates in place.
- `commitState()` — ends the gesture so the next `updateState` checkpoints again. Wire it to drag-end (`onZoomFocusDragEnd={commitState}`, `onBlurDataCommit={commitState}`, …).

`SettingsPanel`'s recurring `onXChange` / `onXCommit` prop pairs are the UI side of this contract. `resolve()` does a shallow merge, so handlers must build new arrays rather than mutating nested region objects.

All region types are flat arrays of `{ id, startMs, endMs, ... }` — no track abstraction. `AnnotationRegion` is a union-by-`type` over `text | image | figure | blur`; blur is an annotation subtype that the UI splits out into its own timeline row and settings panel. Annotation `position`/`size` are **percent (0-100)**; crop is **normalized 0-1**; zoom `focus` is normalized 0-1 with `depth` 1-6.

### Preview and export share their math — this is the load-bearing decision

`src/components/video-editor/videoPlayback/*` holds pure, framework-free zoom/layout helpers (`findDominantRegion`, `applyZoomTransform`, `adaptiveSmoothFactor`, `smoothCursorFocus`, `computeCompositeLayout`). Both the live Pixi ticker in `VideoPlayback.tsx` and the offline `frameRenderer.ts` import the same functions and call them with the same shape. **If you change zoom/layout behavior, change it there — not in one consumer.**

Preview: a hidden `<video>` decodes; PixiJS renders it (`cameraContainer > videoContainer > videoSprite` with blur/motion-blur filters); annotations, crop handles, and the focus indicator are **HTML overlays above the canvas**, not Pixi objects. Props are mirrored into refs so the ticker closure reads fresh values.

Export (`videoExporter.ts`): `web-demuxer` (WASM) → WebCodecs `VideoDecoder` → `FrameRenderer` → WebCodecs `VideoEncoder` (`avc1.640033`) → mediabunny MP4 mux. Because annotations are DOM-only in the preview, `FrameRenderer` re-draws them on canvas 2D with a `scaleFactor` derived from `previewWidth`/`previewHeight` — that's how export matches preview. Trim and speed regions are resolved **at the decoder level**, so the renderer never sees trimmed frames.

Two platform branches in the export path worth knowing: encoder preference is `["prefer-software", "prefer-hardware"]` on **Windows** (hardware encoders are flaky there) and the reverse elsewhere; on **Linux** the GPU shared-image path can silently emit empty frames, so frames are forced through a CPU `getImageData` readback.

GIF export reuses the same decoder + `FrameRenderer` front half, then hands off to `gif.js` workers.

### Project persistence

`.docsiescreen`, `PROJECT_VERSION = 3`, plain JSON: `{ version, media?: {screenVideoPath, webcamVideoPath?, audioPath?}, editor, videoPath? }` (`videoPath` is a read-only v1 legacy field).

`normalizeProjectEditor` is **total — it never throws** and always returns a valid state. It clamps every region (`endMs >= startMs + 1`, zoom depth 1-6, focus 0-1, speed clamped, annotation position 0-100, crop kept inside the frame), migrates `motionBlurEnabled: boolean` → `motionBlurAmount: number`, cross-validates webcam layout against orientation (`vertical-stack` dropped for landscape, `dual-frame` for portrait, both → picture-in-picture), and forces `voiceover.enabled` false when the generated audio file is missing. Add new persisted fields **inside this normalizer**, not around it.

Dirty tracking compares serialized *normalized* snapshots, so cosmetic differences don't register as edits. `hasUnsavedChanges` is pushed to the main process so it can intercept window close.

### i18n

7 locales × 7 namespaces = 49 JSON files under `src/i18n/locales/`, all eagerly bundled via `import.meta.glob`. `t("editor.foo.bar")` splits on the **first** dot into namespace + key.

Two overlapping checks: at runtime, a locale missing any required namespace file is silently **dropped from the language picker**; at build time, `npm run i18n:check` compares flattened key paths against `en` and fails on missing/extra keys. Neither verifies that a value was actually translated (an English copy passes) or that `{{placeholders}}` survived.

### Docsie integration

Renderer: `DocsiePublishDialog.tsx` (largest file in the repo), `DocsieTemplatePicker.tsx`, `src/components/docsie/DocsieAuthGate.tsx`, shared types in `src/lib/docsieIntegration.ts`. Main: `electron/ipc/docsie.ts`, surfaced as ~18 `docsie:*` IPC channels.

Publish flow: save connection settings → (optionally exchange a web desktop-auth handoff for a bearer token) → list workspaces → list target shelves → list generation templates → fetch credit balance + estimate → read video from disk → request temp upload URL → upload bytes → register file via `/files/upload/` → submit `video-to-docs` job → poll → fetch result + generated file links → save to local per-video history.

Desktop auth: the app registers the `docsie-screen://` protocol; Docsie web redirects to `docsie-screen://connect?handoff_id=...&state=...&api_base_url=...`, which main exchanges at `/desktop-auth/handoffs/exchange/`. See `DOCSIE_DESKTOP_AUTH.md`.

When `generation_template_id` is set, the renderer keeps custom template text as fallback only and main sends an empty `template_instruction` — never send both, they conflict as template sources.

Updates (`electron/updateChecker.ts`) are a **notification + download prompt** against the GitHub releases API, not silent self-update.

## Licensing Boundary

Mixed-license repo, and this matters for where code goes:

- Root/inherited OpenScreen code stays **MIT** (`LICENSE`). Upstream notices must remain intact.
- New Docsie-only commercial work goes under `enterprise/` and follows `enterprise/LICENSE.md`.
- Enterprise code may call into MIT core; copying MIT files into `enterprise/` does not relicense them.

Read `LICENSING.md` before moving code across that boundary.

## Testing Notes

Well covered: `compositeLayout` (the richest suite — anchoring, orientation consistency, preset clamping), `projectPersistence` (legacy migration, normalization, dirty detection), `streamingDecoder` duration validation, `gradientParser`, `userPreferences` migration, `blurEffects` (asserts mosaic is information-lossy, i.e. verifying privacy not just appearance), `useCameraDevices`.

Untested: `useEditorHistory` (the gesture protocol, `MAX_HISTORY = 80`, future-clearing — all unverified), `frameRenderer` compositing, the zoom math in `videoPlayback/*` (only exercised indirectly through browser export tests), `zoomSuggestionUtils`, and every React component. `fast-check` is installed but unused.

`HEADLESS=true` makes every window invisible — used by e2e.

## Sharp Edges

- **Circular import:** `handlers.ts` imports `RECORDINGS_DIR` from `../main` while `main.ts` imports `registerIpcHandlers` from it. Works only because that constant is evaluated at `main.ts` top level. Moving it below the imports breaks startup obscurely.
- **`app.getPath("userData")` is read at module scope** in `handlers.ts`, `docsie.ts`, and `updateChecker.ts` — before `app.whenReady()` and before `app.setName()`. The userData dir is therefore derived from `package.json`'s `name`, not the display name.
- **The countdown-overlay hide is deliberately debounced 1200 ms** with an opacity-first sequence guarded by a monotonic id (and a separate Linux branch, since `setOpacity` isn't supported there). Don't "simplify" it to `win.hide()` — it exists to avoid compositor flashes on rapid restart.
- **`get-recorded-video-path` sorts by mtime, not name** — lexicographic sort breaks on `recording-9` vs `recording-10`.
- Recording filenames may not contain path segments (`resolveRecordingOutputPath` rejects any).
- The macOS CoreAudio switch (`disable-features=MacCatapLoopbackAudioForScreenShare`) must stay at `main.ts` module top level, before `app.whenReady()`.
- `AUDIO_EDITING_ENABLED` in `VideoEditor.tsx` is `false` — `AudioEditorPanel.tsx` is live code behind a disabled flag.

## Files To Read First

`src/components/video-editor/VideoEditor.tsx`, `src/hooks/useEditorHistory.ts`, `src/components/video-editor/types.ts`, `src/components/video-editor/projectPersistence.ts`, `src/components/video-editor/videoPlayback/`, `src/lib/exporter/frameRenderer.ts`, `electron/main.ts`, `electron/ipc/handlers.ts`, `electron/ipc/docsie.ts`, `electron/preload.ts`.

Related docs: `AGENTS.md` (Docsie bridge feature status + roadmap), `DOCSIE_DESKTOP_AUTH.md`, `RELEASING.md`, `LICENSING.md`.
