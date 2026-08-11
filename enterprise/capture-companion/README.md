# Docsie Capture Companion

This directory contains the Docsie-owned Capture Companion application layer.

## License

Unless a file states otherwise, the source in this directory is licensed under
the [Docsie Enterprise License](../LICENSE.md), identified in source headers as:

```text
SPDX-License-Identifier: LicenseRef-Docsie-Enterprise-1.0
```

This is a source-available enterprise license with use and redistribution
restrictions. It is not an OSI-approved open-source license.

## Boundary

The Capture Companion UI and demo simulator are enterprise modules. They call
into recorder, Electron, internationalization, and Docsie API bridge code that
currently lives outside this directory. Code outside `enterprise/` remains
under the root MIT license unless its file header explicitly says otherwise.

Moving these entry modules does not relicense inherited OpenScreen code, nor
does it revoke licenses previously granted for earlier published versions.
