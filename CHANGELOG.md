# Changelog

All notable changes to the Outline++ extension will be documented in this file.

This changelog adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is structured for clarity and readability, inspired by [Common Changelog](https://common-changelog.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [1.2.0] - 2026-07-11

### Added
- **Web extension support.** Outline++ now ships a browser bundle and runs on vscode.dev / github.dev. (Modifier icons and all region features work in the web host; there are no Node dependencies left in the runtime.)
- **PowerShell and LaTeX** join the default region-pattern map (`#region`/`#endregion` and `% #region` respectively). `bat`/`ini` were evaluated and skipped — neither has a standard region idiom.
- **Unclosed regions are now visible.** A `#region` with no matching end used to be silently dropped (its closed children promoted). It now appears in the trees and folds, extending to its last closed child's end (or end-of-file if it has none), and is still flagged with an invalid-marker diagnostic.
- **Large-file indicator.** When a file exceeds the 100,000-line parsing limit, a status-bar item now says so — an empty Regions view on a huge file is no longer indistinguishable from "no regions".
- **Command feedback.** Region commands that have nothing to do (no editor, no regions, cursor outside every region) now show a transient status-bar message naming the reason.
- **Screen-reader labels.** Tree items carry `accessibilityInformation` with modifiers spelled out ("private static method Foo") and no emoji, so announcements and type-ahead work; the visible badge labels are unchanged.
- **Light-theme icon variants.** The 15 modifier overlay icons now ship light and dark versions (the old single set used Dark+ colors everywhere; light themes got low-contrast icons).
- **Continuous integration:** GitHub Actions workflow running the full suite on push/PR (first validation occurs on first push).
- **Restricted Mode support:** the extension now declares limited untrusted-workspace capabilities instead of being silently dead; custom region patterns (the one workspace-injectable regex surface) require trust.

### Changed
- **Default keybindings unified** into the single `Ctrl+Alt+<letter>` family (macOS: `Cmd+Alt+<letter>`), with macOS variants for all five commands (previously 1 of 5). Changed: Go to Region Boundary `Alt+M` → `Ctrl+Alt+M`; Select Current Region `Alt+Shift+M` → `Ctrl+Alt+S`. Unchanged: Go to Region… `Ctrl+Alt+R`; Go to Next Region `Ctrl+Alt+N`; Go to Previous Region `Ctrl+Alt+P`. Note that `Ctrl+Alt+<letter>` can collide with AltGr layouts and other extensions' defaults (e.g. Code Runner's `Ctrl+Alt+N`) — remap in the Keyboard Shortcuts editor if affected.
- **Command palette entries** now use a proper command category ("Outline++: …") instead of baked-in title prefixes; the two stale Start/Stop auto-highlight variants no longer both appear (their visibility conditions were in a manifest field VS Code ignores).
- **Tree-item identity is now scoped per document**, fixing collapse/expand state bleeding between files that contain same-named symbols or regions. One-time effect: the Outline++ view's persisted collapse state resets once after upgrading (the Regions view's state is preserved).
- **Marketplace categories** are now Programming Languages + Visualization (was Other).
- Escape in the Go to Region picker restores the exact pre-open viewport instead of recentering on the cursor; opening the picker with the cursor outside every region no longer scrolls the editor to the first region.
- The internal extension API (`extension.exports`) now returns `undefined` in production — it was already undocumented as of 1.1.0; it is now genuinely test-only.

### Fixed
- **Auto-highlight no longer dies after outline-neutral edits.** Editing inside a line (no structural change) left the outline's version gate permanently stale, silently disabling cursor tracking until the next structural edit — the strongest suspect for the May 2026 report. Three adjacent race conditions (highlight-vs-tree-refresh ordering, dropped-selection re-assert, keystroke cancellation without re-trigger) were fixed in the same pass.
- **Modifier extraction corrected on everyday code:** `public int X { get; private set; }` no longer shows a private padlock (earliest declaration keyword wins, not longest); keywords inside string literals are ignored; `constructor(private foo)` no longer marks the constructor private; `Static`/`Override`/`Async` identifiers are no longer matched case-insensitively as modifiers; C++ visibility now correctly tracks `public:`/`private:`/`protected:` section labels for all members (previously only the first member after a label); plain C files no longer get spurious modifier coloring.
- **Region diagnostics race:** rapid editor switching could land one document's invalid-region markers on another document's URI; stale line numbers could throw; closed documents kept their diagnostics forever. Markers are now captured with their document identity, applied only if still current, clamped, and cleared on close.
- **Anchored end-region patterns:** a line like `# endregions handled below` no longer closes a region in the 14 hash-comment languages (patterns now anchored like the C-family ones).
- **Configuration writes respect the effective scope:** the view-title auto-highlight toggles used to always write Global settings — a silent no-op whenever a workspace setting shadowed the value.
- **`modifierDisplay` / `useDistinctModifierColors` take effect immediately** instead of waiting for the next structural edit.
- **Invalid custom region patterns now warn** (once, naming the language, with a Show Log button) instead of silently disabling the language.
- **The Refresh buttons actually refresh:** the symbol path now retries while a language server is still warming up, and a manual refresh always redraws the tree even when the recomputed outline is identical (recovery from a stuck view is the button's purpose).
- **Collapse state survives folder renames/deletes** (handlers only matched exact file URIs, so folder-level events silently orphaned state); persisted state is now also capped (LRU, 200 documents) instead of growing forever.
- Filtering the Go to Region picker to zero matches no longer leaves a stale region highlight in the editor.

### Performance
- Keystroke-to-tree latency cut by ~200 ms: the outline's second 250 ms debounce (whose inputs arrive pre-debounced) is now a 50 ms pairing window.
- Folding no longer triggers a second, undebounced full parse per edit burst (cache serves same-document requests; folding ranges converge via `onDidChangeFoldingRanges`), and the folding provider only registers for languages with region patterns instead of every file on disk.
- Modifier extraction no longer compiles 20–40 fresh regular expressions per symbol per keystroke — all patterns are precompiled.
- Files with no symbol provider (.txt, .log, .csv…) no longer trigger ~10 overlapping cross-host symbol queries per edit pause; exhaustion is tracked per file until something changes.
- A→B→A tab switches reuse a cached parse (LRU, evicted on document close); unchanged documents skip the recursive symbol sort; `output:`-scheme documents are ignored; transient editor-focus loss (e.g. clicking a webview) no longer clears and rebuilds the outline.

### Security
- Workspace-provided region regexes are gated behind workspace trust, and region markers on lines longer than 500 characters are ignored as ReDoS defense-in-depth.

### Removed
- ~600 lines of dead or duplicated code: unused exports, dead re-entrancy guards, an orphaned benchmark script, the command-registration union machinery, the three-file conditional-type config layer, a duplicate navigation command, and the two tree providers' ~90% duplicated implementation (now a shared base class).

---

## [1.1.0] - 2026-06-23

### Removed
- **Public Extension API.** `docs/API.md` is deleted and the "Extension API" section is removed from the README. The methods previously listed (`getTopLevelRegions`, `getFlattenedRegions`, `getActiveRegion`, `getInvalidMarkers`, `getTopLevelFullOutlineItems`, `getActiveFullOutlineItem`, and their change events) remain on `extension.exports` as internal test infrastructure but are no longer documented, no longer expose an `apiVersion` field, and carry no compatibility promise — they may change or disappear in any future release without notice. The internal type was renamed `OutlinePlusAPI` → `OutlineInternalAPI`. External consumers should not depend on these methods.
- The programmatic auto-hide implementation and the manual show/hide surface for both views: the `outlinePlus.regionsView.isVisible`, `outlinePlus.regionsView.shouldAutoHide`, and `outlinePlus.fullOutlineView.isVisible` settings, plus the `Show`/`Hide Regions View`, `Show`/`Hide Full Outline View`, and `Reset Regions View Auto-Hide Preference` commands. View visibility is now handled through VS Code's native view show/hide (the right-click "Views" menu). The `shouldAutoHighlightActive*` settings and the auto-highlight toggle commands are unchanged.

### Changed
- Updated dependencies.
- **Sidebar view renamed:** the second Explorer tree view is now labeled **"Outline++"** instead of "Full Outline" (both the view header and the contextual title). The underlying view ID (`outlinePlusFullTreeView`), command IDs (`outlinePlus.fullOutlineView.*`), and configuration keys (`outlinePlus.fullOutlineView.*`) are unchanged, so existing keybindings and `settings.json` entries continue to work.
- **Both tree views now behave like the built-in Outline/Timeline views.** The **Regions** and **Outline++** views are always registered, so they always appear in the Explorer's right-click "Views" menu and can be shown or hidden there — previously, once hidden a view vanished from that menu and could only be restored from Settings. When the active document has nothing to show, the view displays a brief placeholder ("No regions found" / "No outline available") instead of disappearing entirely.

### Fixed
- **Collapsing the Regions view no longer strands it.** Collapsing the view, then visiting a document with no regions, then returning to one with regions, previously left the view permanently gone (recoverable only via Settings). Collapse/hide state is now managed natively by VS Code, which remembers it across documents.
- **Outline++ now highlights the correct item when a region marker sits inside a symbol.** A region's range extends to its `#endregion` marker, which can fall outside the enclosing symbol's range, making the region and symbol overlapping siblings in the merged tree. Clicking such a region (or moving the cursor onto its marker line) used to highlight the broader parent symbol; the active-item search now picks the most specific (smallest) range containing the cursor.
- **Outline++ "Expand All" now expands trees deeper than 3 levels.** VS Code's `reveal` API expands at most 3 levels per call, so deeply nested outlines (e.g. C# `namespace > class > region > member`) left their lowest level collapsed. Expand All now reveals an anchor every 3 levels to fully expand the tree. The Regions view's Expand All got the same fix.

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
