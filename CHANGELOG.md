# Changelog

All notable changes to the Outline++ extension will be documented in this file.

This changelog adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is structured for clarity and readability, inspired by [Common Changelog](https://common-changelog.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.4] - 2026-05-30

### Added
- Built-in region-boundary patterns for **Stata** (`languageId: stata`, used by both `kylebarron.stata-enhanced` and `mdob2k.stata-language` for `.do` / `.ado` / `.mata` files). Supports both `* #region NAME` / `* #endregion` and `// #region NAME` / `// #endregion` marker styles.

### Changed
- **Keybinding:** Changed default for **Outline++: Go to Region...** from `Ctrl+Shift+R` / `Cmd+Shift+R` to `Ctrl+Alt+R` / `Cmd+Alt+R`. The previous default collided with VS Code's built-in "Debug: Start Without Debugging." Users who rely on the old binding can restore it via VS Code's Keyboard Shortcuts editor.
- Edits to `outlinePlus.regionBoundaryPatternByLanguageId` now apply immediately without requiring an extension reload.

### Fixed
- `RegionFoldingProvider` reuses the cached parse from `RegionStore` for the active document instead of re-parsing on every fold-provider invocation.
- `FullOutlineStore` no longer sticks on a previous file when its underlying stores hold mismatched document IDs mid-switch; it now schedules a retry to recover.
- `DocumentSymbolStore` no longer keeps reporting the previous file's `versionedDocumentId` when the user opens a file whose language has no registered symbol provider (e.g. Stata `.do` files). Without this, the Full Outline tree would stick on the prior file's items because the symbol-store side never advanced to the new URI.
- `DocumentSymbolStore` retry chain bails out before sleeping when a newer refresh has been requested, eliminating wasted wall-clock time after rapid editor switches.
- `extractSymbolModifiers` no longer flags TypeScript object computed-property names like `{ [abstract]: true }` as `abstract`, and decorator-style `@keyword` matching is restricted to languages that opt in via `@`-prefixed entries (Python).
- Modifier extraction cache evicts entries for prior document versions on each text change, preventing the LRU from filling with dead per-version entries.
- Pending collapsible-state writes are flushed during extension `deactivate()` so up to ~15s of collapse/expand state is no longer lost on shutdown.

---

## [1.0.3] - 2026-05-30

### Documentation
- Added Acknowledgements section to README crediting [vscode-region-helper](https://github.com/alythobani/vscode-region-helper) as the upstream project from which Outline++ was forked.

## [1.0.2] - 2026-04-19

### Changed
- Increased document-parsing debounce from 100 ms to 250 ms to reduce main-thread load during rapid edits. Introduced a **tiered debounce system**: 250 ms for expensive parsing operations, 100 ms for lightweight cursor tracking and UI refresh.

### Internal
- Centralized all command IDs, view IDs, configuration keys, and debounce timing constants into `src/constants.ts`, eliminating over 60 magic string duplications.
- Updated `@vscode/vsce` to `^3.9.1`; added npm `overrides` to replace deprecated `glob@11.1.0` with `glob@13.0.0`.

---

## [1.0.1] - 2026-03-30

### Added
- Debug logging commands: **Outline++: Show Debug Log** and **Outline++: Dump Diagnostic State** for diagnosing refresh issues.

### Changed
- Renamed npm package identifier from `outline-plus` to `outline-regions-plus` to match the VS Code Marketplace listing.

---

## [1.0.0] - 2026-03-29

✨ Initial release as Outline++ ✨
