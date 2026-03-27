# Changelog

All notable changes to the "region-helper" extension will be documented in this file.

This changelog adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) and is structured for clarity and readability, inspired by [Common Changelog](https://common-changelog.org/) and [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.7.1] - 2026-03-26

- Improved language parsing to catch cases that confused modifier-aware icons.
- Added LIMITATIONS.md

## [1.7.0] - 2026-02-25

Bug fixes and new features, including debugging option detailed in [DEV_NOTES.md](./docs/DEV_NOTES.md).

### New view title bar buttons
Both the **Regions** and **Full Outline** views now have a **Refresh** button (circular arrow icon) in position @0 of the navigation bar. The auto-highlight toggle buttons remain at position @1.

### Bug 1: "Full Outline doesn't update when reorganizing code"
**Location:** FullOutlineStore.ts `refreshFullOutline()`

The `FullOutlineStore` required the `RegionStore` and `DocumentSymbolStore` to have an **exact versioned document ID match** before refreshing. Since `RegionStore` parses synchronously (immediately has the latest version) while `DocumentSymbolStore` fetches async (lags behind), during any edit sequence the versions would mismatch and the refresh was **silently skipped**. This is why switching away and back "fixed" it — that triggered `onDidChangeActiveTextEditor` which re-synchronized both stores.

**Fix:** Relaxed the check to only block when the stores are looking at *different documents entirely* (different URIs), not different versions of the same document. The outline now refreshes with whatever data is available and self-corrects when both stores converge.

### Bug 2: "Extension gets stuck on one editor"  
**Location:** DocumentSymbolStore.ts `refreshDocumentSymbols()`

A classic async race condition. When switching editors rapidly:
1. Fetch starts for Editor A (async)
2. User switches to Editor B, fetch starts for B
3. B's fetch completes first — correct data stored
4. A's fetch completes later — **overwrites state with stale data from A!**

Now the active view is stuck showing A's outline even though B is active.

**Fix:** Added a monotonically increasing `_refreshGeneration` counter. Each top-level refresh increments it; when an async fetch completes, it checks whether its generation is still current. Stale fetches from previous editors are silently discarded.

### Bug 3: Wrong-document triggers from background edits
**Location:** DocumentSymbolStore.ts `onDidChangeTextDocument` listener

`onDidChangeTextDocument` fires for **all** open documents, not just the active one. With dozens of editors open, background saves, auto-formatters, or extension updates on non-active documents could trigger a symbol fetch for the wrong document.

**Fix:** Added an active-document guard so only changes to the active editor's document trigger a refresh.

## Changes Made

### New files
- refreshViews.ts — Refresh commands for both views
- debugLog.ts — Debug logging infrastructure

### Modified files (8 files)

| File | Changes |
|------|---------|
| DocumentSymbolStore.ts | Race condition fix (generation counter), active-doc guard on `onDidChangeTextDocument`, `forceRefresh()`, debug logging |
| FullOutlineStore.ts | Relaxed version-match gating to document-ID match, `forceRefresh()`, debug logging |
| RegionStore.ts | `forceRefresh()`, debug logging |
| CollapsibleStateManager.ts | Added `Disposable` interface, `dispose()` flushes pending state save |
| getVersionedDocumentId.ts | Added `extractDocumentIdFromVersioned()` helper |
| registerCommand.ts | Added `fullOutlineStore` to closured params, registered refresh commands |
| extension.ts | Wired up debug log init, debug commands, `fullOutlineStore` in command params |
| package.json | Added refresh commands, refresh buttons in view title bars, debug setting, debug commands |

## [1.6.2] - 2026-01-30

**New feature: Outline Modifier Icons** 
Optionally display additional icons and colors to indicate characteristics of objects in the FULL OUTLINE view.

## [1.5.3] - 2025-12-20

- Slight adjustments to README, and also a re-publish attempt since VSCode seemed to silently fail to fully publish v1.5.2

## [1.5.2] - 2025-12-17

- Remove `.mypy_cache/` from published package to reduce package size

## [1.5.1] - 2025-12-17

- **Fix/add default region pattern support for .NET languages**:
  - **C#**: Correct the default region boundary patterns config for C#, to properly match C#'s native `#region` and `#endregion` directives (rather than `// #region` and `// #endregion` comment markers)
  - **Visual Basic**: Add Visual Basic's native `#Region` and `#End Region` directive patterns to the default region boundary patterns configuration

## [1.5.0] - 2025-05-22

- **Improve auto-highlighting of active tree view items**: The Regions and Full Outline views now only auto-highlight their active item when the view is visible, removing the need for the user to toggle auto-highlighting off when wanting to remain in another panel (e.g. Search) or keep a view collapsed

## [1.4.1] - 2025-05-20

- **Extend block comment region pattern support**
  - Add block comment region syntax (e.g. `/* #region */`) to default region boundary patterns configuration for `javascript`, `javascriptreact`, `typescript`, `typescriptreact`, and `vue` languages.
  - Adjust block comment region syntax for `less`, `css`, `postcss`, `scss`, and the above JS-based languages to allow for one or more opening/closing asterisks, e.g. `/** #region */` or `/*** #endregion ***/`

## [1.4.0] - 2025-05-14

- **Add Collapse/Expand All actions**: Action buttons added to the Regions and Full Outline tree views' title bars to collapse or expand all tree items
- **Add persistent tree view state**: Expanded/collapsed items are remembered when switching files or restarting VS Code
- **Fix PHP default region support:** Add `#region` and `#endregion` region syntax to default PHP boundary patterns configuration

## [1.3.0] - 2025-03-18

- Add PostCSS language support

## [1.2.2] - 2025-03-12

- Lower the minimum supported VS Code version from 1.97.0 to 1.94.0 (can now install extension in Cursor)

## [1.2.1] - 2025-03-11

- Remove readme screenshot from the published package

## [1.2.0] - 2025-03-11

- **Add Auto-Highlight toggling for views**: New settings, commands, and view title bar actions to **enable/disable automatic region/item highlighting** in Regions View and Full Outline View.

## [1.1.0] - 2025-03-09

- **Add Full Outline View**: A new tree view combining **regions and language symbols**.
- **Expose API access to Full Outline Data**, allowing other extensions to retrieve and listen to full outline items.
- **Improve region tree UI**: Region items now use the `symbol-namespace` icon for a more **consistent look**.
- **Enhance selection behavior**: "Select Current Region" now extends the selection to the **end of the last line**.
- **Optimize performance**: **More robust debouncing** ensures smoother updates, especially in **large files**.
- **Reduce console errors** from tree updates in large files.

## [1.0.3] - 2025-02-22

- Fix README copy

## [1.0.2] - 2025-02-22

- Remove unnecessary files from the published package

## [1.0.0] - 2025-02-22

✨ Initial release ✨

- **Introduce Interactive Region Tree**, allowing easy navigation of code regions.
- **Add diagnostics for unmatched region boundaries**, helping catch incomplete or misplaced regions.
- **Add commands for quick region navigation**:
  - `region-helper.goToRegionBoundary`
  - `region-helper.selectCurrentRegion`
  - `region-helper.goToRegionFromQuickPick`
  - `region-helper.goToNextRegion`
  - `region-helper.goToPreviousRegion`
- **Support 48 languages** out of the box.
- **Enable custom region patterns** via configuration settings.
