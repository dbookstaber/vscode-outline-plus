# Feature Request: Public API to resolve the source resource URI behind a built-in webview preview tab

> **ARCHIVED 2026-08-10.** Retained here for the research; no action pending.
> A working prototype once existed on the `Webview` branch (single commit, 2026-06-02):
> a `getOutlineTargetDocument` resolver wired into `DocumentSymbolStore`, `FullOutlineStore`,
> `RegionStore`, and `FullTreeViewProvider`, plus `previewModeDiagnostics.test.ts`. It populated
> the full outline for classic Markdown preview tabs, but the outline was **static** — no cursor
> tracking, no viewport sync, no click-to-navigate — because the API below does not exist. The
> branch was deleted once upstream declined the request; the prototype was never merged.

> **OUTCOME — CLOSED `*out-of-scope` (not planned), 2026-06.**
> Filed as [microsoft/vscode#319242](https://github.com/microsoft/vscode/issues/319242); closed by the VS Code maintainer (mjbvz) as by-design. Verbatim reasoning:
> > "This is by-design. Webviews (which the classic preview use) aren't linked to a resource and in the md case actually update dynamically to preview the latest text document. Custom editors (which are used by the preview editor flow) are. I don't want to make a special case just for markdown previews in the API"
>
> **Interpretation.** The objection has two prongs: (1) "no markdown special-case" — dodgeable by a reframe; (2) "webviews aren't resource-bound, and the preview updates dynamically" — *not* dodgeable, and it's the real wall, stated by the owner of both the tabs API and the markdown extension. A re-file is therefore low expected-value. The one reframe that addresses prong 2 is a **generic, opt-in resource hint on `WebviewPanel`** (the webview's *creator* may advertise an associated resource, surfaced on `TabInputWebview`) — general, not markdown-specific, and opt-in so it doesn't claim a stable binding the model doesn't guarantee. Estimated odds remain low (~10–15%) since adoption by the markdown extension is also owned by the same maintainer. The text below is retained as the historical request and as the basis for any such follow-up comment.

## Summary

When a built-in webview-backed preview (most notably the **classic Markdown preview**) is the active tab, there is no public, supported API for an extension to discover which source document that preview is rendering. `vscode.window.activeTextEditor` is `undefined` for webview-backed tabs, and the tab descriptor for the classic preview (`vscode.TabInputWebview`) exposes only a `viewType` string and **no `uri`**. Extensions that follow the active document (custom outlines, breadcrumbs, navigation panels) therefore go blank whenever the user switches to the classic Markdown preview, with no reliable way to recover the source `.md` file.

## Current behavior (empirically verified on VS Code 1.122)

- **Markdown preview *editor*** — opened via `vscode.openWith` with viewType `vscode.markdown.preview.editor` (the editor-title toggle whose tooltip is "Reopen as source file"). This surfaces as a `vscode.TabInputCustom` on `window.tabGroups.activeTabGroup.activeTab.input`, and **`TabInputCustom.uri` exposes the source document URI**. Extensions CAN resolve the source file in this case. (No change requested here — this case already works.)
- **Classic Markdown preview** — opened via `markdown.showPreview` / `markdown.showPreviewToSide` (Ctrl+Shift+V / Ctrl+K V). This surfaces as a `vscode.TabInputWebview` with `viewType` = `"mainThreadWebview-markdown.preview"`. **`TabInputWebview` exposes ONLY `viewType` (a string) and NO `uri`.** There is no public API to map this webview tab back to the source `.md` file it is rendering.
- For a **full-tab** `markdown.showPreview`, the source document is frequently **not** present in `window.visibleTextEditors` (it can be `[]`), so the common "just use the single visible editor" heuristic fails. Side-by-side `showPreviewToSide` does keep the source visible, but that is only one sub-case and cannot be relied upon.

Net effect: for the classic full-tab Markdown preview there is no supported path from the active tab to the source resource URI.

## Use case

Extensions that render document-centric UI and follow the active document — custom outline trees, structural navigators, table-of-contents / breadcrumb panels, minimap-like views. When the user opens a Markdown preview to read or present, these views currently lose the document context and go blank, even though the source file is open in the workspace and the preview clearly knows which file it is rendering. A supported way to obtain the source URI would let these extensions keep working seamlessly across the editor/preview boundary.

## Proposed API (any one of these would resolve the gap)

1. **Add a `uri` / `resource` (or `sourceUri`) field to `TabInputWebview`** for built-in previews, mirroring what `TabInputCustom.uri` already provides. This is the smallest, most direct change.
2. **A general `window.tabGroups` accessor** exposing the resource a webview tab is associated with (when the host knows it), so any built-in or well-behaved webview can advertise its backing resource.
3. **A Markdown-specific active-resource API** — e.g. an `onDidChangeActiveMarkdownPreview` event and/or an `activeMarkdownPreviewResource` property reporting the source document of the currently active preview.

## Existing issues

I checked the closest existing issues; **none currently covers this specific request** (a public way to resolve the *source resource URI* behind a built-in webview-preview tab). Summary of what exists:

- [microsoft/vscode#49915](https://github.com/microsoft/vscode/issues/49915) — "Provide an active editor for webviews via window.onDidChangeActiveTextEditor" — **closed/completed**. Resolved by the Custom Editors API (custom editors can participate in the outline and control the active editor). It does **not** address mapping a built-in webview/preview tab to its source resource.
- [microsoft/vscode#101682](https://github.com/microsoft/vscode/issues/101682) — "vscode.window.activeTextEditor still set after focusing on webview" — **closed/completed** (bug, insiders-released). About `activeTextEditor` becoming `undefined`/stale on webview focus; it is the cause of the blank-outline symptom but provides no resource-resolution API.
- [microsoft/vscode#84886](https://github.com/microsoft/vscode/issues/84886) — "Use markdown preview like regular webview for extensions" — **closed**, labeled `*out-of-scope`. Different ask (treating the preview as a generic extension webview).
- [microsoft/vscode#154145](https://github.com/microsoft/vscode/issues/154145) — "API to open a markdown preview as a preview editor" — **closed** (not planned), labeled `*out-of-scope`. About *opening* the classic preview as a preview/custom editor, not about *reading* the source URI of an already-open preview tab.
- [microsoft/vscode#201884](https://github.com/microsoft/vscode/issues/201884) — "TabInputWebview viewType comment is inaccurate/unclear or there is a bug in viewType" — **OPEN**, labeled `api`, `markdown-ext`, `tabs`. This is the closest live issue: it concerns identifying the Markdown-preview `TabInputWebview` via its `viewType` (`mainThreadWebview-markdown.preview`), but only the *viewType string*, not exposing the **source URI**. It is adjacent, not a duplicate — and a good cross-reference / place to mention this need.
