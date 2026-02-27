<!-- markdownlint-disable no-inline-html -->

# Region Helper

A Visual Studio Code extension for navigating, visualizing, and managing code regions.

This fork features higher performance, more features, and fewer bugs than the original!

**[QuickStart](./docs/DEV_NOTES.md#1-install-dependencies)**

## ⚡️ Features

- 📁 **Regions View** – Interactive tree for viewing and navigating regions.
- 🏛 **Full Outline View** – Like VSCode's builtin Outline view, but incorporates regions.
- 🎨 **Modifier-Aware Icons** – Color-coded icons showing visibility and member modifiers for C#, Java, TypeScript, Python, and more.
- 🐇 **Quick Navigation** – Jump, search, and select regions with commands and keyboard shortcuts.
- ⚠️ **Diagnostics** – Detects unmatched region boundaries.
- 🔄 **Refresh & Debug** – Manual refresh buttons and built-in debug logging for diagnosing issues.

![Region Helper Demo](./assets/readme-gifs/0-main-demo.gif)

## 📖 Table of Contents

1. [⚡️ Features](#-features)
2. [📖 Table of Contents](#-table-of-contents)
3. [🔬 Detailed Features](#-detailed-features)
   1. [📂 Regions View](#-regions-view)
   2. [🏛 Full Outline View](#-full-outline-view)
   3. [🎨 Modifier-Aware Icons](#-modifier-aware-icons)
   4. [⚠️ Region Diagnostics](#️-region-diagnostics)
   5. [🔍 Go to Region...](#-go-to-region)
   6. [🐇 Go to Region Boundary](#-go-to-region-boundary)
   7. [⏭ Go to Next / Previous Region](#-go-to-next--previous-region)
   8. [🎯 Select Current Region](#-select-current-region)
4. [⚙️ Settings](#️-settings)
   1. [🙈 Show/Hide Views](#-showhide-views)
   2. [🔄 Toggling Auto-Highlighting in Views](#-toggling-auto-highlightingrevealing-in-tree-views)
   3. [🎨 Modifier Display Settings](#-modifier-display-settings)
   4. [🔧 Custom Region Patterns](#-custom-region-patterns)
5. [🛠 Troubleshooting](#-troubleshooting)
   1. [🔄 Manual Refresh](#-manual-refresh)
   2. [🐛 Debug Logging](#-debug-logging)
6. [📡 Extension API](#-extension-api)
7. [🚧 Known Limitations](#-known-limitations)

## 🔬 Detailed Features

### 📂 Regions View

- Displays a **structured tree view** of all regions in the current file.
- **Automatically reveals and highlights** the cursor’s active region (this can be toggled on/off with commands/settings).
- Click a region to **instantly navigate** to it.

![Regions View Demo](./assets/readme-gifs/1-regions-view.gif)

### 🏛 Full Outline View

- Combines all **regions and language symbols** (classes, methods, variables, etc) into a **unified tree view** for the current file.
- Just like the Regions View, the cursor's active region/symbol is **automatically revealed and highlighted**, and this behavior can be toggled on/off.
- Click any item to **instantly navigate** to it.

![Full Outline View Demo](./assets/readme-gifs/2-full-outline-view.gif)

### 🎨 Modifier-Aware Icons

The Full Outline view can display **color-coded icons** that indicate the visibility and characteristics of symbols — similar to Visual Studio's Document Outline.

**Custom SVG overlay icons** are provided for common combinations (e.g., a private static method shows a distinct icon). When overlay icons aren't available, the standard VS Code symbol icon is tinted with a color representing the symbol's visibility.

#### Supported Languages

| Language | Visibility Modifiers | Member Modifiers |
|----------|---------------------|------------------|
| **C#** | `public`, `private`, `protected`, `internal`, `protected internal`, `private protected` | `static`, `readonly`, `const`, `abstract`, `virtual`, `override`, `async`, `sealed`, `extern`, `volatile`, `new` |
| **Java** | `public`, `private`, `protected` | `static`, `final`, `abstract`, `volatile`, `sealed` |
| **Kotlin** | `public`, `private`, `protected`, `internal` | `const`, `val`, `abstract`, `override`, `sealed` |
| **TypeScript/JavaScript** | `public`, `private`, `protected` | `static`, `readonly`, `const`, `abstract`, `async`, `override` |
| **C/C++** | `public`, `private`, `protected` | `static`, `const`, `constexpr`, `virtual`, `override`, `volatile`, `extern` |
| **Python** | (via naming conventions: `_name` = protected, `__name` = private) | `@staticmethod`, `@classmethod`, `@abstractmethod`, `async` |

#### Color Legend

| Color | Meaning |
|-------|---------|
| 🟢 Green | `public` |
| 🔴 Red | `private` |
| 🟡 Yellow | `protected` |
| 🔵 Blue | `internal` / `package` |
| 🟠 Orange | `protected internal` |
| 🟣 Purple | `private protected` |

#### Display Modes

Controlled by `regionHelper.fullOutlineView.modifierDisplay`:

| Mode | Behavior |
|------|----------|
| `"off"` | Standard VS Code symbol icons only |
| `"colorOnly"` | Icon colors reflect visibility |
| `"colorAndBadge"` | Colors + emoji badge prefixes on labels (default) |
| `"colorAndSvgOverlay"` | Colors + custom SVG overlay icons for methods/fields/properties |
| `"colorAndDescription"` | Colors + text descriptions to the right of symbol names (e.g., "static", "readonly") |

> **Tooltips** are always enhanced to show `[modifier list] SymbolName: line range`, regardless of display mode.

For technical details on the icon system, see [OUTLINE_MODIFIER_ICONS.md](./OUTLINE_MODIFIER_ICONS.md).


### ⚠️ Region Diagnostics

- Detects **unmatched region boundaries** and adds warnings in both the editor (blue squiggles) and the Problems panel, helping you **catch incomplete or misplaced** regions quickly.

![Region Diagnostics Demo](./assets/readme-gifs/3-diagnostics.gif)

### 🔍 Go to Region...

- Like VSCode’s built-in **"Go to Symbol..."**, but for regions:
  - Opens a **fuzzy-searchable dropdown** to jump to any region in the current file.
- 📌 **Default Keybinding**:
  - **Windows/Linux**: `Ctrl + Shift + R`
  - **Mac**: `Cmd + Shift + R`

![Go to Region Demo](./assets/readme-gifs/4-go-to-region.gif)

### 🐇 Go to Region Boundary

- Like VSCode’s built-in **"Go to Bracket"**, but for regions:
  - Jumps between **matching start and end region boundaries**.
  - Jumps to the **next region** if the cursor is not already inside a region.
- 📌 **Default Keybinding**: `Alt + M`

![Go to Region Boundary Demo](./assets/readme-gifs/5-go-to-boundary.gif)

### ⏭ Go to Next / Previous Region

- Jumps to the **next or previous region** in the file.
- 📌 **Default Keybindings**:
  - **Next Region**: `Ctrl + Alt + N`
  - **Previous Region**: `Ctrl + Alt + P`

![Go to Next / Previous Region Demo](./assets/readme-gifs/6-go-to-next-previous-region.gif)

### 🎯 Select Current Region

- Selects the **entire active region** containing the cursor.
- 📌 **Default Keybinding**: `Alt + Shift + M`

![Select Current Region Demo](./assets/readme-gifs/7-select-region.gif)

## ⚙️ Settings

### 🙈 Show/Hide Views

To quickly show or hide the **Regions** or **Full Outline** views, you can use the following commands and associated settings:

- **Show/Hide Region View**
  - Commands: `Show Regions View` / `Hide Regions View`
  - Setting: `regionHelper.regionsView.isVisible`
- **Show/Hide Full Outline View**
  - Commands: `Show Full Outline View` / `Hide Full Outline View`
  - Setting: `regionHelper.fullOutlineView.isVisible`

### 🔄 Toggling Auto-Highlighting/Revealing in Tree Views

- By default, the Regions and Full Outline views will **automatically reveal and highlight** the cursor's active region or symbol as you navigate the editor.
- If you ever want to **disable this auto-revealing behavior** (e.g. for a more stable scroll position), you can use the `{Stop/Start} Auto-Highlighting Active {Region/Item}` commands, or click the tree view's **title bar action** (the sync icon) to toggle it on/off.

### 🎨 Modifier Display Settings

Settings under `regionHelper.fullOutlineView`:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `modifierDisplay` | string | `"colorAndBadge"` | Controls how modifiers are displayed. Values: `"off"`, `"colorOnly"`, `"colorAndBadge"`, `"colorAndSvgOverlay"`, `"colorAndDescription"` |
| `useDistinctModifierColors` | boolean | `true` | Use distinct colors (green=public, red=private, yellow=protected) vs subtle symbol-themed colors |

### 🔧 Custom Region Patterns

- **Supports 50 languages** out of the box, including:
  - **C, C++, C#, Java, Python, JavaScript, JSX, TypeScript, TSX, PHP, Ruby, Swift, Go, Rust, HTML, XML, Markdown, JSON/JSONC, YAML, SQL, and more**.
- Define your own **custom region patterns**, or adjust the **existing default patterns**, to customize how regions are parsed.
  - Setting: `regionHelper.regionBoundaryPatternByLanguageId`
    - Note: you may need to restart the extension after changing this setting for it to take effect.

## 🛠 Troubleshooting

### 🔄 Manual Refresh

Both the **Regions** and **Full Outline** views have a **Refresh** button (↻) in the view's title bar. Click it to force a complete re-fetch of all data, bypassing any caching or change-detection. You can also run the commands from the Command Palette:

- **Region Helper: Refresh Regions View**
- **Region Helper: Refresh Full Outline**

### 🐛 Debug Logging

If the outline gets stuck or stops updating, you can capture diagnostic information:

1. **Enable debug logging**: Open Settings (`Ctrl+,`) → search for `regionHelper.enableDebugLogging` → set to `true`.
2. **Reproduce the problem**.
3. **Dump diagnostic state**: Open the Command Palette (`Ctrl+Shift+P`) → run **Region Helper: Dump Diagnostic State**. This opens the "Region Helper" Output channel with a snapshot of all internal store state.
4. **Show the debug log**: Run **Region Helper: Show Debug Log** to review the full timeline of state transitions.

The log captures editor switches, symbol fetches, discarded stale fetches, and version mismatches — all the data needed to diagnose refresh issues.

## 📡 Extension API

Region Helper provides an API for accessing **parsed code regions** and **full outline symbols** programmatically. You can use it to build your own VSCode region extension without worrying about writing a region parser from scratch!

**See the full [API documentation](./docs/API.md) for details and examples.**


## 🚧 Known Limitations

- 🔍 **Go to Region...** only supports **camelCase matching** (not full fuzzy search) due to a [VSCode API limitation](https://github.com/microsoft/vscode/issues/34088#issuecomment-328734452).
- The 📁 **Regions** and 🏛 **Full Outline** tree views **always highlight the cursor's last active item**, even when outside any region/symbol ([another VSCode API limitation](https://github.com/microsoft/vscode/issues/48754)).
- 🎨 **Modifier extraction** relies on parsing the document text to match language-specific keyword patterns. It does not use the Language Server Protocol's symbol tags (which are not yet widely supported). This means modifier detection may be imperfect for complex or unusual code patterns.
