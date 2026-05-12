# AGENTS.md

This file documents how the current Docsie Screen Recorder editor works, what was added for the Docsie bridge, and where to extend it for future AI features.

## Overview

This fork is currently a **local desktop capture + editing client** for Docsie:

- Capture and import recordings in Electron
- Edit them in a React-based timeline editor
- Export rendered video/GIF locally
- Send the current recording to Docsie's existing **Video to Docs** external API flow

Important boundary:

- The **editor-side and Electron-side Docsie integration are implemented in this repo**
- The **Docsie backend processing already existed** and is consumed through the external API
- This pass did **not** add new Django server code under the main `docsie/` app

## Main Entry Points

- App shell: `src/App.tsx`
- Main editor: `src/components/video-editor/VideoEditor.tsx`
- Undo/redo editor state: `src/hooks/useEditorHistory.ts`
- Preview player/compositor: `src/components/video-editor/VideoPlayback.tsx`
- Timeline UI: `src/components/video-editor/timeline/TimelineEditor.tsx`
- Settings side panel: `src/components/video-editor/SettingsPanel.tsx`
- Project persistence: `src/components/video-editor/projectPersistence.ts`
- Export pipeline: `src/lib/exporter/videoExporter.ts`, `src/lib/exporter/gifExporter.ts`, `src/lib/exporter/frameRenderer.ts`

## Editor Model

The editor is built around one undoable state object in `useEditorHistory.ts`:

- `zoomRegions`
- `trimRegions`
- `speedRegions`
- `annotationRegions`
- crop/layout/look settings
- webcam layout settings

Selections and playback runtime are intentionally **not** part of undo state. `VideoEditor.tsx` keeps those as non-undoable React state.

### Annotation Model

Annotations are first-class timeline objects defined in `src/components/video-editor/types.ts`.

Supported annotation types:

- `text`
- `image`
- `figure`
- `blur`

Each annotation has:

- `startMs`, `endMs`
- `position`, `size`
- `zIndex`
- text styling
- optional figure/blur payloads

This is the key seam for future AI-assisted editing. If an LLM or external service can produce valid `AnnotationRegion[]`, the editor, preview, persistence, and export stack already know how to handle them.

## Current Editor Flow

`VideoEditor.tsx` is the orchestration layer.

It currently:

- loads the active recording or a saved project
- keeps non-undoable runtime state like current time, selections, export progress, and loaded file paths
- splits `annotationRegions` into normal annotations vs blur regions
- passes editor state into the preview, timeline, and settings panel
- opens export and Docsie publishing dialogs

### Preview

`VideoPlayback.tsx` renders the interactive preview:

- main screen video
- optional webcam video
- crop/layout/border/shadow
- zoom focus interaction
- draggable/resizable annotations and blur regions
- cursor telemetry-assisted zoom suggestions

### Timeline

`TimelineEditor.tsx` manages timeline rows for:

- zoom
- trim
- speed
- annotation
- blur

All of these feed back into the same editor state and history model.

### Persistence

Projects are saved through `projectPersistence.ts`.

Current project file facts:

- extension: `.docsiescreen`
- versioned format: `PROJECT_VERSION = 2`
- stores media references plus full editor state
- persists `annotationRegions`, zooms, trims, speeds, crop, layout, and export preferences

If we add AI-generated edits later, they should be persisted by keeping them inside the existing editor state shape instead of inventing a parallel storage system.

## Export Pipeline

The export path already supports annotations.

Key pieces:

- `VideoExporter` and `GifExporter` assemble render jobs
- `FrameRenderer` composites the screen/webcam layout and then renders annotations on top
- `frameRenderer.ts` calls `renderAnnotations(...)` during export

That means there is no need to rewrite export to support auto-annotations. As long as suggestions become normal `annotationRegions`, they will show up in:

- live preview
- saved projects
- local exports

## Docsie Bridge Added In This Fork

The Docsie integration is a desktop client bridge to the existing Docsie external API.

### Renderer/UI

- Publish dialog: `src/components/video-editor/DocsiePublishDialog.tsx`
- Template browser: `src/components/video-editor/DocsieTemplatePicker.tsx`
- Docsie auth gate: `src/components/docsie/DocsieAuthGate.tsx`
- Launch point in editor toolbar: `src/components/video-editor/VideoEditor.tsx`
- Shared request/response types: `src/lib/docsieIntegration.ts`

The dialog currently supports:

- Docsie API base URL
- `Api-Key` or `Bearer` auth mode
- Docsie web sign-in / desktop handoff connection flow
- workspace selection
- target Docsie shelf selection, including creating a new shelf from the book title and reusing it on future runs
- quality tier
- language
- doc style
- rewrite instructions
- Docsie generation template selection through a searchable template browser
- fallback template instructions when no generation template is selected
- auto-generate toggle
- cost estimate
- current Docsie credit balance display
- job polling
- retry / "Run Analysis Again" after failed jobs
- generated file actions for markdown, DOCX, and PDF
- local analysis history per source video, with completed result reopening inside the dialog

### Electron/Main Process

- Preload bridge: `electron/preload.ts`
- IPC handlers: `electron/ipc/handlers.ts`
- Docsie API implementation: `electron/ipc/docsie.ts`
- Update checker: `electron/updateChecker.ts`

Current flow:

1. Save Docsie connection settings locally
2. Optionally exchange a Docsie web desktop-auth handoff for a bearer token
3. List Docsie workspaces
4. List target documentation shelves for the selected workspace
5. List Docsie video-to-docs generation templates
6. Fetch current Docsie credit balance and estimate video-to-docs credits
7. Read the current exported/recorded video from disk
8. Request a temporary upload URL from Docsie
9. Upload the binary to Docsie storage
10. Register the uploaded file in Docsie
11. Submit the `video-to-docs` job with workspace, target shelf, style, template, language, and generation options
12. Poll analysis/generation status
13. Fetch final result payload, generated file links, and markdown preview
14. Save completed results into local per-video history

### Token Storage

The recorder stores Docsie connection settings in Electron user data:

- file: `docsie-integration.json`
- path root comes from `app.getPath("userData")`

The token is encrypted with `safeStorage` when available. If the platform cannot encrypt, it falls back to plaintext storage in that local config file.

This is acceptable for the current bridge, but for production auth hardening we should move to a stronger session/token strategy.

### Local Docsie State Files

Additional Docsie-related local state also lives under `app.getPath("userData")`:

- `docsie-video-to-docs-history.json`: completed Video to Docs results keyed by normalized source video path
- `update-check.json`: skipped update version for the native update prompt

Do not store these inside project files unless the product explicitly needs portable Docsie result history.

### Desktop Auth Handoff

The app registers the `docsie-screen://` protocol in `electron/main.ts`.

Docsie web can redirect back to:

- `docsie-screen://connect?handoff_id=...&state=...&api_base_url=...`

The main process exchanges that handoff through:

- `/desktop-auth/handoffs/exchange/`

The returned bearer token and workspace defaults are persisted through the same encrypted local config path used by manual tokens.

### Video To Docs Targeting

The video-to-docs request path supports:

- `workspace_id`
- `target_documentation_id`
- `book_title`
- `generation_template_id`
- `template_instruction`
- `rewrite_instructions`
- `auto_generate`

When `generation_template_id` is selected, the renderer keeps custom template text as fallback only and the main process sends an empty `template_instruction`. This prevents conflicting template sources.

The upload registration currently calls `/files/upload/` with `type: "file"` after uploading the video bytes through a temporary URL. The backend is expected to allow video media registration for the video-only API-key flow.

### Result History

Completed Video to Docs runs are saved locally per source video. The history entry stores:

- workspace and organization context
- selected quality, language, doc style, template, target shelf, and book title
- analysis and generation job IDs
- final Docsie job result, including markdown, file/export URLs, Docsie document identifiers, and credit details

Opening an entry from history should load the saved result back into `DocsiePublishDialog`, not immediately navigate out to Docsie.

### Release And Update Flow

Release helpers:

- `npm run release:patch`
- `npm run release:minor`
- `npm run release:major`
- `npm run release:tag -- [tag]`
- `npm run release:local`

`scripts/release.mjs` bumps `package.json`, commits the version bump, pushes the branch, and pushes a fresh release tag. It defaults to the `private` remote when present.

`.github/workflows/release.yml` builds Windows, Linux, and macOS artifacts on GitHub Actions and publishes the GitHub release. The README should use `/releases/latest/download/...` links so the current installer follows the latest published release.

`electron/updateChecker.ts` checks GitHub's latest release API on startup and through `Help -> Check for Updates...`. It compares the latest tag against `app.getVersion()`, prompts the user when a newer release exists, and opens the best installer asset for the current OS/architecture.

Important limitations:

- This is an update notification/download flow, not silent in-app self-update.
- Builds before the update checker existed cannot notify users retroactively; users must manually install one update that contains the checker.
- macOS signing and notarization steps are present in the release workflow, but they are skipped unless Apple signing/notarization secrets are configured.

## What Is Implemented vs Not Implemented

Implemented now:

- Docsie branding/theme changes across the recorder/editor
- local packaging/build flow
- editor-side Docsie publishing dialog
- Electron IPC bridge to Docsie external API
- upload, submit, estimate, poll, and result preview
- Docsie web desktop-auth handoff into the Electron app
- Docsie workspace and shelf selection
- Docsie generation template browser
- current credit balance retrieval
- failed-job retry through "Run Analysis Again"
- local per-video analysis history
- update notification prompt backed by GitHub releases
- auto-incrementing release commands and GitHub release publishing

Not implemented yet:

- full PKCE/OAuth inside Electron without the Docsie web handoff
- importing Docsie-generated structure back into the local timeline automatically
- server-driven auto-annotation writeback into the editor
- doc-to-video authoring flow without a source recording
- silent automatic update download/install
- signed and notarized macOS releases until Apple credentials are configured

## Best Extension Point For LLM Auto-Annotations

The clean path is:

1. Analyze the recording with Docsie or another AI service
2. Return structured suggestions, ideally normalized to `AnnotationRegion[]`
3. Insert them into editor state in `VideoEditor.tsx`
4. Let the existing preview/export/persistence stack handle the rest

Useful follow-on AI outputs that fit the current model:

- `AnnotationRegion[]`
- `ZoomRegion[]`
- `TrimRegion[]`
- `SpeedRegion[]`
- chapter markers or suggested cut points

Recommended implementation shape:

- keep AI generation outside the core editor renderer
- add one import/apply layer that validates the generated JSON
- merge suggestions into history with `pushState(...)`

This keeps AI optional and reversible with normal undo/redo.

## Using This Editor For Documentation-to-Video

Yes, the same editing stack can be reused for documentation-to-video, but there is one important limitation:

- the **current editor assumes a loaded source video exists**

What is already reusable:

- timeline editing model
- annotation model
- layering and styling controls
- export pipeline
- project persistence format

What doc-to-video would still need:

- a scene generator or synthetic media source
- support for step/image/title-card timelines without requiring a recorded screen video
- an adapter that converts Docsie documentation structure into editor state

A good direction is to generate a project-like intermediate model from Docsie content, then map it into:

- base media or synthetic scenes
- `annotationRegions`
- zoom/crop/speed regions where useful
- export settings

In practice, this means the current editor is a strong foundation for doc-to-video, but it is not yet a full doc-to-video authoring tool out of the box.

## Recommended Next Steps

If continuing this work, the highest-value next additions are:

1. Add a validated JSON import path for AI-generated annotations and zooms
2. Harden Docsie auth/session lifecycle beyond the current encrypted local bearer-token cache
3. Add result import from Docsie generation back into the local editor
4. Define an intermediate "scene/step" model for documentation-to-video generation
5. Extend the editor to support non-recording timelines for synthetic video creation
6. Configure Apple Developer ID signing and notarization secrets in GitHub Actions
7. Add a true auto-update installer path if we want updates to apply without manual download

## Files To Read First

For anyone extending this feature set, start here:

- `src/components/video-editor/VideoEditor.tsx`
- `src/hooks/useEditorHistory.ts`
- `src/components/video-editor/types.ts`
- `src/components/video-editor/projectPersistence.ts`
- `src/components/video-editor/DocsiePublishDialog.tsx`
- `src/components/video-editor/DocsieTemplatePicker.tsx`
- `src/components/docsie/DocsieAuthGate.tsx`
- `electron/ipc/docsie.ts`
- `electron/ipc/handlers.ts`
- `electron/preload.ts`
- `electron/main.ts`
- `electron/updateChecker.ts`
- `scripts/release.mjs`
- `.github/workflows/release.yml`
- `src/lib/exporter/frameRenderer.ts`
