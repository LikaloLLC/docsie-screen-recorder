# Licensing

This repository is intentionally **mixed-license**.

## 1. Upstream and Root Code

The original OpenScreen codebase, plus any files that do not explicitly state
otherwise, remain licensed under the root [LICENSE](./LICENSE), which is the
upstream MIT license.

That means:

- upstream MIT notices must stay intact
- inherited MIT-covered code cannot be made retroactively proprietary
- derivative work built from MIT code may still carry MIT obligations for the
  inherited portions

## 2. Docsie Enterprise Subtree

Code, assets, and documentation placed under [enterprise/](./enterprise/) are
intended for **Docsie-authored enterprise features** and are covered by the
license in [enterprise/LICENSE.md](./enterprise/LICENSE.md), unless a file says
otherwise.

This boundary is here so the repo can support:

- MIT-licensed inherited recorder/editor code
- separately licensed Docsie-only enterprise extensions

## 3. Practical Rule For Contributors

If you want a feature to stay outside the MIT inheritance boundary as much as
possible:

- implement it as new code under `enterprise/`
- avoid copying upstream files into `enterprise/`
- keep upstream notices when enterprise code wraps or calls MIT code

If you modify an existing MIT file outside `enterprise/`, that file still
contains MIT-governed upstream material.

## 4. Release Note

This structure is an engineering and repository boundary, not legal advice.
Before external commercial distribution, the final licensing model should be
reviewed by counsel.
