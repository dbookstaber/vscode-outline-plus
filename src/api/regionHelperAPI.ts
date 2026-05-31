import type * as vscode from "vscode";

import { type FlattenedRegion } from "../lib/flattenRegions";
import { type InvalidMarker } from "../lib/parseAllRegions";
import { type Region } from "../models/Region";
import { type FullTreeItem } from "../treeView/fullTreeView/FullTreeItem";

/** Discriminates {@link OutlineItem} entries between region markers and language-server symbols. */
export type OutlineItemKind = "region" | "symbol";

/**
 * Plain-data outline item exposed via the public API. Does NOT extend `vscode.TreeItem` —
 * consumers should not rely on internal UI properties (icon, tooltip, collapsibleState, etc.).
 * Only the fields declared here are guaranteed under the current `apiVersion`.
 */
export type OutlineItem = {
  readonly kind: OutlineItemKind;
  /** Display name (region name or symbol name). */
  readonly name: string;
  /** Source range covered by this item. */
  readonly range: vscode.Range;
  readonly children: readonly OutlineItem[];
};

/**
 * Public API surface returned from `activate()`. Follows semver:
 * - `apiVersion` major bumps on breaking changes to existing fields/methods.
 * - Adding new fields/methods is non-breaking and does NOT bump the major.
 *
 * Consumers should check `apiVersion` to detect incompatible changes.
 */
export type OutlinePlusAPI = {
  /** Semver-ish version of this API surface. Major bumps on breaking changes. */
  readonly apiVersion: "1.0";
  // #region Regions API
  // #region Getters
  /** Returns an up-to-date list of top-level regions in the current active editor. This is used to
   * render the tree view, for example. The list will be empty if no editor is active. */
  getTopLevelRegions(): Region[];
  /** Returns an up-to-date flat list of all regions in the current active editor, each of which has
   * an extra `flatRegionIdx` field on it. This is used when navigating to previous/next regions,
   * for example.  The list will be empty if no editor is active. */
  getFlattenedRegions(): FlattenedRegion[];
  /** Returns the currently active region in the current active editor, if any. */
  getActiveRegion(): Region | undefined;
  /** Returns an up-to-date list of invalid markers (unmatched boundaries) in the current active
   * editor. The list will be empty if no editor is active. */
  getInvalidMarkers(): InvalidMarker[];
  // #endregion
  // #region Events
  /** An event that fires when the list of regions in the current active editor changes. */
  onDidChangeRegions: vscode.Event<void>;
  /** An event that fires when the active region in the current active editor changes. */
  onDidChangeActiveRegion: vscode.Event<void>;
  /** An event that fires when the list of invalid markers in the current active editor changes. */
  onDidChangeInvalidMarkers: vscode.Event<void>;
  // #endregion
  // #endregion
  // #region Full Outline API
  // #region Getters
  /** Returns the top-level outline items (regions + symbols, merged) for the active editor. */
  getTopLevelFullOutlineItems(): OutlineItem[];
  /** Returns the outline item containing the cursor in the active editor, if any. */
  getActiveFullOutlineItem(): OutlineItem | undefined;
  // #endregion
  // #region Events
  onDidChangeFullOutlineItems: vscode.Event<void>;
  onDidChangeActiveFullOutlineItem: vscode.Event<void>;
  // #endregion
  // #endregion
};

/**
 * Converts an internal {@link FullTreeItem} (a `vscode.TreeItem` subclass) into the plain
 * {@link OutlineItem} shape exposed by the public API. Strips UI-only properties (icon,
 * tooltip, collapsibleState, contextValue, modifiers, command, label prefix, etc.) so
 * consumers don't accidentally couple to internals.
 */
export function toOutlineItem(item: FullTreeItem): OutlineItem {
  return {
    kind: item.itemType,
    name: item.displayName,
    range: item.range,
    children: item.children.map(toOutlineItem),
  };
}
