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
- Launch point in editor toolbar: `src/components/video-editor/VideoEditor.tsx`
- Shared request/response types: `src/lib/docsieIntegration.ts`

The dialog currently supports:

- Docsie API base URL
- `Api-Key` or `Bearer` auth mode
- workspace selection
- quality tier
- language
- doc style
- rewrite instructions
- template instructions
- auto-generate toggle
- cost estimate
- job polling
- markdown/result preview

### Electron/Main Process

- Preload bridge: `electron/preload.ts`
- IPC handlers: `electron/ipc/handlers.ts`
- Docsie API implementation: `electron/ipc/docsie.ts`

Current flow:

1. Save Docsie connection settings locally
2. List Docsie workspaces
3. Estimate video-to-docs credits
4. Read the current exported/recorded video from disk
5. Request a temporary upload URL from Docsie
6. Upload the binary to Docsie storage
7. Register the uploaded file in Docsie
8. Submit the `video-to-docs` job
9. Poll analysis/generation status
10. Fetch final result payload and markdown preview

### Token Storage

The recorder stores Docsie connection settings in Electron user data:

- file: `docsie-integration.json`
- path root comes from `app.getPath("userData")`

The token is encrypted with `safeStorage` when available. If the platform cannot encrypt, it falls back to plaintext storage in that local config file.

This is acceptable for the current bridge, but for production auth hardening we should move to a stronger session/token strategy.

## What Is Implemented vs Not Implemented

Implemented now:

- Docsie branding/theme changes across the recorder/editor
- local packaging/build flow
- editor-side Docsie publishing dialog
- Electron IPC bridge to Docsie external API
- upload, submit, estimate, poll, and result preview

Not implemented yet:

- direct Docsie account sign-in / PKCE login flow
- deep linking into a specific Docsie editor shelf/documentation target
- importing Docsie-generated structure back into the local timeline automatically
- server-driven auto-annotation writeback into the editor
- doc-to-video authoring flow without a source recording

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
2. Add explicit Docsie auth/session handoff instead of manual token entry
3. Add result import from Docsie generation back into the local editor
4. Define an intermediate "scene/step" model for documentation-to-video generation
5. Extend the editor to support non-recording timelines for synthetic video creation

## Files To Read First

For anyone extending this feature set, start here:

- `src/components/video-editor/VideoEditor.tsx`
- `src/hooks/useEditorHistory.ts`
- `src/components/video-editor/types.ts`
- `src/components/video-editor/projectPersistence.ts`
- `src/components/video-editor/DocsiePublishDialog.tsx`
- `electron/ipc/docsie.ts`
- `electron/ipc/handlers.ts`
- `electron/preload.ts`
- `src/lib/exporter/frameRenderer.ts`
