# Docsie Capture Companion

This directory contains the Docsie-owned Capture Companion application layer.

## License

Unless a file states otherwise, the source in this directory is licensed under
the [Docsie Capture Companion Enterprise License](./LICENSE.md), identified in
source headers as:

```text
SPDX-License-Identifier: LicenseRef-Docsie-Capture-Companion-Enterprise-1.0
```

This is a source-available enterprise license with use and redistribution
restrictions. It is not an OSI-approved open-source license.

## Boundary

The Capture Companion UI and demo simulator are enterprise modules. They call
into recorder, Electron, internationalization, and Docsie API bridge code that
currently lives outside this directory. Code outside `enterprise/` remains
under the root MIT license unless its file header explicitly says otherwise.

The inherited OpenScreen code and all other code outside this directory remain
under their existing licenses, including the root MIT License where applicable.
