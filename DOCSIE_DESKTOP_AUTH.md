# Docsie Screen Recorder Desktop Auth

This note describes how the screen recorder should authenticate with Docsie by reusing the same ideas already implemented for the MCP connector.

## Goal

Avoid manual token copy/paste.

The user should start inside Docsie web, launch `Docsie Screen Recorder`, and arrive in the desktop app with:

- the correct organization context
- the correct workspace
- optional defaults like `quality`, `doc_style`, `template_instruction`
- a revocable desktop session stored securely on the device

## What We Can Reuse From MCP

The MCP connector already proves the right pattern on the Docsie side:

- browser-based login stays in Docsie web
- user chooses which organization to authorize
- Docsie creates an org-scoped OAuth application dynamically
- standard OAuth provider endpoints still handle the token issuance

Relevant files:

- MCP authorize flow: `/Users/philippetrounev/PycharmProjects/docsie.io/docsie/api/views_mcp_oauth.py`
- OAuth route wiring: `/Users/philippetrounev/PycharmProjects/docsie.io/config/urls.py`
- MCP metadata server: `/Users/philippetrounev/PycharmProjects/docsie.io/mcp-server/app/main.py`

## Recommended Desktop Flow

Desktop should not copy the Claude connector flow exactly.

Claude can consume OAuth metadata directly. A desktop app should instead use a short-lived browser handoff.

### Proposed sequence

1. User clicks `Open in Docsie Screen Recorder` inside Docsie web.
2. Docsie backend creates a short-lived handoff record with:
   - user
   - organization
   - workspace
   - optional generation defaults
   - one-time nonce / state
3. Docsie opens a custom protocol URL such as:
   - `docsie-screen://connect?handoff_id=...&state=...`
4. Electron main process receives the custom protocol URL.
5. Electron exchanges that handoff with Docsie over HTTPS.
6. Docsie validates the handoff and returns:
   - short-lived access token
   - refresh token or renewable desktop session
   - org/workspace context
   - UI defaults for the publish flow
7. Electron stores the session in secure storage.
8. Renderer only receives safe auth state, never the raw tokens.

## Why Not Reuse MCP Endpoints Directly

`/o2/mcp/authorize/` is designed for a browser-based third-party connector that discovers OAuth metadata and completes PKCE itself.

The recorder is different:

- it is launched from Docsie web
- it should feel first-party
- it needs to pre-bind workspace and generation defaults
- it needs a cleaner install / fallback path when the app is not yet installed

So the right reuse is:

- same organization-picker concept
- same org-scoped OAuth application concept
- same secure token issuance model

But a different transport:

- `web handoff -> desktop exchange`

## Suggested Backend Shape

### New OAuth application type

Add a dedicated application type for the recorder, for example:

- `screen_recorder`

That keeps desktop sessions separate from MCP connector sessions.

### Suggested endpoints

- `POST /api/internal/desktop-handoffs/create/`
- `POST /api/internal/desktop-handoffs/exchange/`
- `POST /api/internal/desktop-handoffs/revoke/`

Or a versioned external equivalent if we want the desktop app to use public API surfaces only.

### Handoff payload

At minimum:

- `handoff_id`
- `state`
- `organization_id`
- `workspace_id`
- `workspace_name`
- `quality`
- `doc_style`
- `language`
- `template_instruction`
- `target_documentation_id`
- `return_url`

## Recorder Integration Points

Current recorder files to extend:

- Electron token/config bridge:
  `/Users/philippetrounev/PycharmProjects/docsie.io/external/openscreen/electron/ipc/docsie.ts`
- IPC registration:
  `/Users/philippetrounev/PycharmProjects/docsie.io/external/openscreen/electron/ipc/handlers.ts`
- Renderer bridge:
  `/Users/philippetrounev/PycharmProjects/docsie.io/external/openscreen/electron/preload.ts`
- Publish UI:
  `/Users/philippetrounev/PycharmProjects/docsie.io/external/openscreen/src/components/video-editor/DocsiePublishDialog.tsx`

## Security Requirements

- handoff must be single-use
- handoff TTL should be short, around 60 seconds
- desktop access token should be short-lived
- refresh token should be revocable
- secrets stay in Electron main process only
- renderer gets derived auth state, not raw credentials
- desktop logout should revoke or clear the stored session

## Practical v1

The fastest usable version is:

1. Docsie web creates handoff
2. custom protocol launches recorder
3. recorder exchanges handoff for a token
4. recorder stores token with secure storage
5. existing `video-to-docs` upload/submit/poll flow stays unchanged

That gets us from Docsie web into the desktop recorder with the correct org/workspace context, without asking the user to paste an API token into the app.
