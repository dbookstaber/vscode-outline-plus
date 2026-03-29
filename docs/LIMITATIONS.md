# Known Limitations

This document catalogues the known limitations of the Outline++ extension, explains why each has been accepted, and describes alternative approaches that were considered and rejected.

---

## Table of Contents

1. [Modifier Extraction Pipeline](#1-modifier-extraction-pipeline)
   - [1.1 Text-Based Extraction (Not LSP)](#11-text-based-extraction-not-lsp)
   - [1.2 Three-Line Lookback Window](#12-three-line-lookback-window)
   - [1.3 Six Supported Languages](#13-six-supported-languages)
   - [1.4 Python Inline `#` Comments Not Stripped](#14-python-inline--comments-not-stripped)
   - [1.5 Block Comment Nesting Not Supported](#15-block-comment-nesting-not-supported)
   - [1.6 Unsupported Languages Still Consume Cache Space](#16-unsupported-languages-still-consume-cache-space)
2. [Caching & Performance](#2-caching--performance)
   - [2.1 LRU Cache Eviction Strategy](#21-lru-cache-eviction-strategy)
   - [2.2 No Performance Metrics](#22-no-performance-metrics)
3. [State Management & Timing](#3-state-management--timing)
   - [3.1 Debounce Delays (100 ms)](#31-debounce-delays-100-ms)
   - [3.2 Region/Symbol Version Mismatch During Rapid Edits](#32-regionsymbol-version-mismatch-during-rapid-edits)
   - [3.3 Failed Symbol Fetches Not Retried on Error](#33-failed-symbol-fetches-not-retried-on-error)
   - [3.4 Retry Delays and Attempt Counts Are Hardcoded](#34-retry-delays-and-attempt-counts-are-hardcoded)
4. [Configuration](#4-configuration)
   - [4.1 Region Patterns Require Restart After Change](#41-region-patterns-require-restart-after-change)
   - [4.2 Invalid Custom Regex Patterns Fail Silently](#42-invalid-custom-regex-patterns-fail-silently)
   - [4.3 Modifier Display Settings Are Global, Not Per-Language](#43-modifier-display-settings-are-global-not-per-language)
5. [Tree View & Display](#5-tree-view--display)
   - [5.1 Tree Views Always Highlight the Last Active Item](#51-tree-views-always-highlight-the-last-active-item)
   - [5.2 Custom SVG Icons Only for Three Symbol Types](#52-custom-svg-icons-only-for-three-symbol-types)
   - [5.3 Collapsed State Lost on Region Rename](#53-collapsed-state-lost-on-region-rename)
6. [Navigation](#6-navigation)
   - [6.1 Go to Region Uses camelCase Matching Only](#61-go-to-region-uses-camelcase-matching-only)
7. [Diagnostics](#7-diagnostics)
   - [7.1 Unmatched Regions Are Warnings, Not Errors](#71-unmatched-regions-are-warnings-not-errors)

---

## 1. Modifier Extraction Pipeline

### 1.1 Text-Based Extraction (Not LSP)

Modifier extraction (visibility, `static`, `readonly`, etc.) works by parsing source text with language-specific regex patterns. It does **not** use the Language Server Protocol's `DocumentSymbol.tags` field.

**Why accepted:** LSP symbol tags are not yet widely populated by language servers. Waiting for adoption would mean no modifier support at all for the foreseeable future.

**Possible fix — Use LSP tags when available, fall back to text parsing:** Rejected because the dual-path implementation would double the maintenance surface for minimal near-term benefit. When LSP tag support matures, the text-based path can be retired in a single migration.

### 1.2 Three-Line Lookback Window

`getSymbolDeclarationText()` scans **up to 3 lines** above a symbol's declaration to find modifiers, attributes, and decorators. Decorator chains longer than 3 lines are truncated.

```python
@decorator_one
@decorator_two
@decorator_three
@decorator_four      # ← NOT captured
def my_method():
    pass
```

**Why accepted:** Expanding the window risks reading past the current symbol's declaration into the body of the preceding symbol, producing false positives. Three lines covers the vast majority of real-world declarations.

**Possible fix — Dynamic boundary detection:** Rejected because no simple heuristic reliably detects "end of prior symbol" across all 6 supported languages. The stop conditions (empty line, brace, semicolon, type-declaration pattern) already handle common cases; a larger window would weaken them.

### 1.3 Six Supported Languages

Full modifier extraction is implemented for: **C#, Java, Kotlin, TypeScript/JavaScript, C/C++, Python** (via naming conventions). Unsupported languages receive a `"default"` visibility with no member modifiers detected.

**Why accepted:** Each language requires hand-authored keyword lists, visibility semantics, and boundary patterns. Adding a language is straightforward but must be done deliberately to avoid incorrect detection.

**Possible fix — User-defined modifier patterns:** Contributions welcome.

### 1.4 Python Inline `#` Comments Not Stripped

The `stripComments()` function removes **standalone** `#` comment lines (where `#` is the first non-whitespace character) but does **not** strip inline `#` comments.

```python
def create_pattern(regex_pattern: str = "#[a-z0-9]+") -> bool:
    pass  # this comment is not stripped
```

**Why accepted:** A regex cannot reliably distinguish `#` starting a comment from `#` inside a string literal. Stripping inline `#` would corrupt string contents, potentially producing spurious modifier matches.

**Possible fix — Python tokenizer:** Rejected because importing or reimplementing a Python tokenizer adds significant complexity and latency for a narrow edge case. The practical impact is low: visibility keywords in inline comments after the declaration keyword are rare, and standalone `#` comment lines (the common case) are already handled.

### 1.5 Block Comment Nesting Not Supported

`stripComments()` uses a non-greedy regex (`/\/\*[\s\S]*?\*\//g`) that does not handle nested block comments.

```c
/* outer /* inner */ still in outer */
                     ^^^^^^^^^^^^^^^^ ← not stripped
```

**Why accepted:** C-family languages (the primary users of `/* */` comments) do not support nested block comments. Languages that do (e.g., Swift, Rust) are not yet in the supported-modifier list.

**Possible fix — Recursive/stateful parser:** Would be implemented when adding support for a language that allows nested block comments.

### 1.6 Unsupported Languages Still Consume Cache Space

`extractSymbolModifiersWithCache()` is called for every language, including unsupported ones. The resulting `"default"` entries occupy LRU cache slots, displacing useful entries.

**Why accepted:** The overhead is small — cache lookups are O(1), and `"default"` entries are computed instantly. Adding a language check before caching would save cache space but complicate the call site.

**Possible fix — Skip caching for unsupported languages:** A reasonable optimisation for a future release if cache pressure becomes a problem in large polyglot workspaces.

---

## 2. Caching & Performance

### 2.1 LRU Cache Eviction Strategy

The modifier cache holds at most **5,000 entries**. When full, the oldest **1,000 entries** are evicted in a single batch. This is insertion-order eviction, not true least-recently-used.

**Why accepted:** A `Map` with insertion-order iteration provides correct-enough eviction with zero bookkeeping overhead. True LRU requires moving entries to the end of the map on every cache hit, which adds complexity for negligible benefit given the 5,000-entry budget.

**Possible fix — True LRU with access-order tracking:** Rejected because the cache is already generous for typical usage (most files have < 200 symbols); true LRU would only matter in extreme workloads.

### 2.2 No Performance Metrics

The extension does not track cache hit/miss rates, modifier extraction time, tree rebuild duration, or language server latency.

**Why accepted:** Shipping a performance dashboard increases maintenance burden and extension size. Debug logging already captures state transitions; timing can be added ad hoc via VS Code's built-in profiler when investigating a report.

---

## 3. State Management & Timing

### 3.1 Debounce Delays (100 ms)

Multiple subsystems debounce updates at **100 ms**: `DocumentSymbolStore`, `RegionStore`, `FullOutlineStore` items, and active-item highlight. During rapid typing, multiple intermediate states are collapsed into one refresh.

**Why accepted:** Without debouncing, every keystroke would trigger a full region re-parse, symbol fetch, tree rebuild, and active-item recomputation — an unacceptable cost. The 100ms delay is below the threshold of human perception for most interactions.

**Possible fix — Configurable debounce:** Rejected because exposing debounce timing adds cognitive load with no clear user benefit. Power users who need lower latency can fork and adjust the constant.

### 3.2 Region/Symbol Version Mismatch During Rapid Edits

`RegionStore` updates synchronously on each edit; `DocumentSymbolStore` updates asynchronously (language server round-trip). During rapid edits, the `FullOutlineStore` may briefly merge regions from document version *N* with symbols from version *N−k*.

**Why accepted:** The alternative — blocking the outline until both stores agree on the exact version — caused the outline to become permanently stale during rapid edits. Allowing version-mismatched merges produces a transiently imperfect tree that self-corrects within one debounce cycle.

### 3.3 Failed Symbol Fetches Not Retried on Error

If `vscode.commands.executeCommand("vscode.executeDocumentSymbolProvider", ...)` throws an exception, the error is logged but not retried. The retry mechanism only activates when the command returns `undefined` (language server not ready).

**Why accepted:** Exceptions from `executeDocumentSymbolProvider` typically indicate permanent failures (broken extension, unsupported document type). Retrying would risk infinite loops on unrecoverable errors.

**Possible fix — One-shot retry with backoff:** Feasible and low-risk; could be added if transient failures are reported in the wild.

### 3.4 Retry Delays and Attempt Counts Are Hardcoded

Symbol-fetch retry logic uses stepped delays (300ms → 1s → 3s → 5s) with a maximum of 10 attempts (~30s total). These values are not user-configurable.

**Why accepted:** The stepped delay profile covers the vast majority of language server startup times. Exposing retry configuration adds settings complexity for an edge case that affects almost no one (language servers slower than 30s are extremely rare).

---

## 4. Configuration

### 4.1 Region Patterns Require Restart After Change

Custom region boundary patterns (`outlinePlus.regionBoundaryPatternByLanguageId`) are compiled into a `Map` at extension startup. Changing the setting at runtime has no effect until the extension is reloaded.

**Why accepted:** Hot-reloading compiled regex patterns would require invalidating all cached parse results, resetting region stores, and re-parsing every open document — a non-trivial amount of plumbing for a setting that users change once during initial setup.

**Possible fix — Listen for `onDidChangeConfiguration`:** A reasonable enhancement. Deferred because the workaround (reload window) is simple and the setting rarely changes.

### 4.2 Invalid Custom Regex Patterns Fail Silently

If a user provides an invalid regex in their custom region pattern, the error is caught and logged to the console but no notification is shown. The affected language silently loses region support.

**Why accepted:** Pop-up notifications on invalid regex would be disruptive during iterative editing of settings. Console logging preserves the error for debugging without interrupting workflow.

**Possible fix — Output channel warning:** A low-severity enhancement that would log to a dedicated Outline++ output channel with a one-time notification.

### 4.3 Modifier Display Settings Are Global, Not Per-Language

The `modifierDisplay` and `useDistinctModifierColors` settings apply identically across all languages. Users cannot choose SVG overlays for C# but simple colors for Python.

**Why accepted:** Per-language display settings would multiply the configuration surface (6 languages × 2 settings = 12 new entries) for marginal benefit. We assume most users want a consistent visual style across their workspace.

---

## 5. Tree View & Display

### 5.1 Tree Views Always Highlight the Last Active Item

The Regions and Full Outline tree views highlight the item under the cursor. When the cursor is outside any region or symbol, the **last highlighted item persists** — there is no "nothing selected" state.

**Cause:** VS Code's `TreeView.reveal()` API does not support deselecting the current item ([vscode#48754](https://github.com/microsoft/vscode/issues/48754)).

**Why accepted:** This is a VS Code platform limitation with no extension-level workaround. The auto-reveal feature can be toggled off via settings if the persistent highlight is distracting.

### 5.2 Custom SVG Icons Only for Three Symbol Types

Custom SVG modifier icons (base icon + modifier badge overlay) are generated only for `symbol-method`, `symbol-property`, and `symbol-field`. All other symbol types use theme icons with color tinting.

**Why accepted:** Each custom SVG icon must be hand-authored at multiple sizes and themes. The three supported types cover the symbols most commonly annotated with visibility modifiers. Contributions welcome!

### 5.3 Collapsed State Lost on Region Rename

Tree item collapsed/expanded state is keyed by a stable ID derived from the region name. Renaming a region creates a new ID; the old ID's state is orphaned in storage and the tree resets to the default expanded state.

**Why accepted:** Detecting renames would require heuristic matching (same line number, similar name) that could produce false positives. The orphaned storage entries are small (a few bytes each) and do not accumulate to a meaningful size.

---

## 6. Navigation

### 6.1 Go to Region Uses camelCase Matching Only

The **Go to Region...** quick picker relies on VS Code's built-in `QuickPick` filtering, which supports camelCase matching but not arbitrary substring or fuzzy search.

**Cause:** VS Code's Quick Pick API does not expose full fuzzy matching in its standard mode ([vscode#34088](https://github.com/microsoft/vscode/issues/34088#issuecomment-328734452)).

**Why accepted:** Implementing custom fuzzy filtering would require replacing the native Quick Pick with a WebView-based picker — substantially more complex, slower to render, and inconsistent with VS Code's built-in UX conventions.

---

## 7. Diagnostics

### 7.1 Unmatched Regions Are Warnings, Not Errors

Unmatched `#region`/`#endregion` pairs are reported with `DiagnosticSeverity.Warning`. They do not prevent the file from being saved or block other diagnostics.

**Why accepted:** Treating unmatched regions as errors would be overly aggressive for codebases with legacy or generated code that incidentally contains partial region markers. Warnings surface the issue without disrupting the developer's workflow.

**Possible fix — Configurable severity:** A simple enhancement that could be exposed via a setting if users report wanting stricter enforcement.
