# Enterprise

This directory is reserved for **Docsie-owned enterprise features** that are
not intended to inherit the repo's default MIT licensing treatment.

Everything under this directory is intended to be licensed under
[enterprise/LICENSE.md](./LICENSE.md), unless a file states otherwise.

## What belongs here

- Docsie-specific authentication integrations
- paid or commercial-only editor extensions
- enterprise deployment adapters
- proprietary templates, premium assets, and gated features

## What should not go here

- copied upstream OpenScreen source files without preserving license context
- attempts to relabel inherited MIT code as non-MIT
- third-party code without its own license review

## Development rule

Prefer building enterprise features as:

- new modules under `enterprise/`
- integrations that call into the MIT recorder/editor core
- adapters and services that keep the license boundary obvious

If enterprise code depends on MIT code, that is fine. But inherited MIT code
does not stop being MIT just because enterprise code uses it.
