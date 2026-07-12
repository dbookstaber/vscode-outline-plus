import type * as vscode from "vscode";

import { type FlattenedRegion } from "../lib/flattenRegions";
import { type InvalidMarker } from "../lib/parseAllRegions";
import { type Region } from "../models/Region";
import { type FullTreeItem } from "../treeView/fullTreeView/FullTreeItem";

/**
 * INTERNAL — not a public contract.
 *
 * This shape is what `activate()` returns via `extension.exports`. It exists
 * because the integration test bundle and the extension bundle each ship their
 * own module copy of `RegionStore`/`FullOutlineStore`, so tests cannot reach
 * the live store instances directly — they go through this bridge instead.
 *
 * External consumers SHOULD NOT depend on these methods. They are undocumented,
 * unversioned, and may change or disappear in any release without notice.
 */

/** Discriminates {@link OutlineItem} entries between region markers and language-server symbols. */
export type OutlineItemKind = "region" | "symbol";

/**
 * Plain-data outline item used at the test/extension boundary so tests don't
 * couple to internal UI properties (icon, tooltip, collapsibleState, etc.).
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
 * Internal-only shape returned from `activate()`. Used by the integration test
 * suite as a cross-bundle bridge into the live stores. Not a published API.
 */
export type OutlineInternalAPI = {
  // #region Regions
  getTopLevelRegions(): Region[];
  getFlattenedRegions(): FlattenedRegion[];
  getActiveRegion(): Region | undefined;
  getInvalidMarkers(): InvalidMarker[];
  onDidChangeRegions: vscode.Event<void>;
  onDidChangeActiveRegion: vscode.Event<void>;
  onDidChangeInvalidMarkers: vscode.Event<void>;
  // #endregion
  // #region Full Outline
  getTopLevelFullOutlineItems(): OutlineItem[];
  getActiveFullOutlineItem(): OutlineItem | undefined;
  onDidChangeFullOutlineItems: vscode.Event<void>;
  onDidChangeActiveFullOutlineItem: vscode.Event<void>;
  // #endregion
  /**
   * Test-only hook returning the live {@link FullTreeItem} instances (with the
   * UI-only properties `OutlineItem` strips — icon, modifiers, command). Declared
   * here rather than smuggled onto the exports via spread. Only present when the
   * extension runs outside `ExtensionMode.Production` (see `activate`).
   */
  _test_getInternalFullOutlineItems(): FullTreeItem[];
};

/**
 * Converts an internal {@link FullTreeItem} (a `vscode.TreeItem` subclass) into the plain
 * {@link OutlineItem} shape used at the test boundary. Strips UI-only properties (icon,
 * tooltip, collapsibleState, contextValue, modifiers, command, label prefix, etc.).
 */
export function toOutlineItem(item: FullTreeItem): OutlineItem {
  return {
    kind: item.itemType,
    name: item.displayName,
    range: item.range,
    children: item.children.map(toOutlineItem),
  };
}
