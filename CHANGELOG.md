# Changelog

All notable changes to the Outline++ extension will be documented in this file.

This changelog adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is structured for clarity and readability, inspired by [Common Changelog](https://common-changelog.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.1.0] - 2026-06-12

### Removed
- **Public Extension API.** `docs/API.md` is deleted and the "Extension API" section is removed from the README. The methods previously listed (`getTopLevelRegions`, `getFlattenedRegions`, `getActiveRegion`, `getInvalidMarkers`, `getTopLevelFullOutlineItems`, `getActiveFullOutlineItem`, and their change events) remain on `extension.exports` as internal test infrastructure but are no longer documented, no longer expose an `apiVersion` field, and carry no compatibility promise — they may change or disappear in any future release without notice. The internal type was renamed `OutlinePlusAPI` → `OutlineInternalAPI`. External consumers should not depend on these methods.

### Changed
- **Sidebar view renamed:** the second Explorer tree view is now labeled **"Outline++"** instead of "Full Outline" (both the view header and the contextual title). The underlying view ID (`outlinePlusFullTreeView`), command IDs (`outlinePlus.fullOutlineView.*`), and configuration keys (`outlinePlus.fullOutlineView.*`) are unchanged, so existing keybindings and `settings.json` entries continue to work.
- Updated dependencies.

---

## [1.0.5] - 2026-05-31

### Performance
- Region tree refresh skips when the parsed region structure is identical (`FullOutlineStore.refreshItems` now mirrors `RegionStore`'s change-check). Eliminates redundant tree invalidations on every debounced edit when nothing the user cares about changed.
- `parseAllRegions` now reads the document via a single `getText().split(/\r?\n/)` instead of allocating a `TextLine` per line via `document.lineAt(i)`. Saves hundreds of thousands of allocations on large files.
- `parseAllRegions` bails out above 100,000 lines (logs to the debug channel). Prevents the host from stalling past the parse-debounce window on very large generated files.
- `RegionStore.refreshRegions` and `DocumentSymbolStore.refreshDocumentSymbols` short-circuit when the new `versionedDocumentId` matches the cached one — same document version means identical results, so the parse + deep-equality walk are skipped.
- SVG modifier icons are memoized at module scope; previously each symbol allocated a fresh `vscode.Uri.file(...)` per refresh even though only ~18 distinct icon combinations exist.
- `getRegionParents` switched from `unshift`-in-loop (O(n²)) to `push` + final `.reverse()` (O(n)) — relevant for deeply nested region trees.
- Tooltips on `RegionTreeItem` and `FullTreeItem` are now built lazily via an instance accessor; constructors no longer eagerly compute tooltip strings for items the user never hovers.
- `FullOutlineStore.forceRefresh` no longer runs a synchronous `refreshFullOutline` in addition to triggering the store force-refreshes. The Refresh title-bar button used to double-fire the tree refresh; it now fires once with current data.
- Webpack `vscode:prepublish` now runs in production mode (minified). Published `dist/extension.js` is ~58% smaller (266 KB → 112 KB).

### Changed
- Internal API hardening: `getTopLevelFullOutlineItems()` and `getActiveFullOutlineItem()` now return a plain-data `OutlineItem` shape (`{ kind, name, range, children }`) instead of leaking the internal `FullTreeItem` UI class. Field rename: `displayName` → `name`.
- `goToFullTreeItem` now jumps to `selectionRange.start` instead of `range.start` for symbol-backed items. For decorator-heavy Python (`@staticmethod\ndef foo():`), the cursor lands on the `def foo` line rather than the decorator above it.
- `activationEvents` narrowed from `["onLanguage"]` (effectively `*` — activated on every language file open) to `["onStartupFinished"]`. The extension now activates once after VS Code finishes startup rather than on each editor session.
- `vscode:prepublish` now runs `npm run pretest && npm run test && npm run compile:prod` so failing tests block `vsce publish`.

### Internal
- Removed the hybrid singleton pattern (`_instance`, `getInstance`, `_resetInstance`, static `initialize`) from `RegionStore`, `DocumentSymbolStore`, and `FullOutlineStore`. Stores are now plain classes with public constructors and constructor injection.
- Dead code cleanup: removed `src/lib/getRegionRange.ts`, `src/utils/getActiveCursorLineIdx.ts`, `src/utils/timeoutUtils.ts`, `src/utils/objectUtils.ts`, and the unreachable `getInitialCollapsibleState` branch in `FullTreeItem`.

### Documentation
- README Table of Contents anchors are now stable across GitHub's slugifier (added explicit `<a id="..."></a>` anchors before headings containing emoji).
- `docs/API.md` now documents `getInvalidMarkers()` and `onDidChangeInvalidMarkers`.

### Tests
- Replaced fixed-delay flake patterns with `waitForCondition` polling in `eventFiringPrecision.test.ts` and `getPreviousRegion.test.ts`.
- `performanceBenchmarks.test.ts` and `regionsViewAutoHide.test.ts` derive their settle windows from `DEBOUNCE_DOCUMENT_PARSE_MS` so a future debounce tune doesn't silently break them.
- `regionsViewAutoHide.test.ts` snapshots Global settings in `suiteSetup` and restores them in `suiteTeardown` as a safety net against tests that throw before per-suite teardown.
- New regression tests:
  - Two `Full Outline Active Editor Switch` tests for the Stata `.do` no-symbol-provider scenario (round-trip TS ↔ Stata).
  - Two `DocumentSymbolStore` tests for no-provider document switching.

---

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

---

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
