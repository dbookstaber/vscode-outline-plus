import * as vscode from "vscode";
import { type FlattenedRegion } from "../lib/flattenRegions";
import { getRegionDisplayName, getRegionRangeText } from "../lib/getRegionDisplayInfo";
import { type Region } from "../models/Region";
import {
    clearHighlightedRegions,
    highlightAndScrollRegionIntoView,
} from "../utils/highlightRegion";
import {
    moveCursorToFirstNonWhitespaceCharOfLine,
    scrollCurrentLineIntoView,
} from "../utils/editorNav";
import { showRegionCommandNoOp } from "./regionCommandFeedback";
import { type OutlinePlusClosuredParams } from "./registerCommand";

export type RegionQuickPickItem = vscode.QuickPickItem & {
  startLineIdx: number;
  endLineIdx: number;
};

export function goToRegionFromQuickPick({ regionStore }: OutlinePlusClosuredParams): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    showRegionCommandNoOp("noEditor");
    return;
  }

  const regionQuickPick = vscode.window.createQuickPick<RegionQuickPickItem>();
  const { flattenedRegions, activeRegion } = regionStore;
  const regionQuickPickItems = getRegionQuickPickItems(flattenedRegions);
  const initialActiveItem = getActiveRegionQuickPickItem({ activeRegion, regionQuickPickItems });
  // Capture the viewport *before* showing the picker so Escape can restore it
  // (rather than recentering on the cursor's current line).
  const originalVisibleRange = activeTextEditor.visibleRanges[0];
  const previewInitially = shouldPreviewInitialItem({ activeRegion, initialActiveItem });

  initializeRegionQuickPick({
    regionQuickPick,
    regionQuickPickItems,
    initialActiveItem,
    activeTextEditor,
    originalVisibleRange,
    previewInitially,
  });
  regionQuickPick.show();
  // Only scroll the editor to the pre-selected item when the cursor is actually
  // inside a region; otherwise opening the picker would yank the viewport to the
  // first region even though the user was looking somewhere else.
  if (previewInitially && initialActiveItem) {
    highlightAndScrollItemIntoView({ regionQuickPickItem: initialActiveItem, activeTextEditor });
  }
}

/**
 * Builds the quick-pick items from the store's already-flattened regions. The
 * flattened list is depth-first pre-order (same order the tree would produce by
 * recursion), and each entry carries a precomputed `depth`, so this no longer
 * re-flattens the tree or re-walks each region's parent chain on every open
 * (plan 4.6). Exported for direct unit testing.
 */
export function getRegionQuickPickItems(
  flattenedRegions: FlattenedRegion[]
): RegionQuickPickItem[] {
  return flattenedRegions.map(makeRegionQuickPickItem);
}

function makeRegionQuickPickItem(region: FlattenedRegion): RegionQuickPickItem {
  const startLineIdx = region.range.start.line;
  const endLineIdx = region.range.end.line;
  const label = getRegionQuickPickItemLabel(region);
  const description = getRegionRangeText(region);
  return { label, description, startLineIdx, endLineIdx };
}

/**
 * Renders a quick-pick label: two spaces of indentation per nesting level
 * (`depth`) followed by the region's display name. Exported for unit testing
 * the indentation rendering.
 */
export function getRegionQuickPickItemLabel(region: FlattenedRegion): string {
  const displayName = getRegionDisplayName(region);
  const indent = "  ".repeat(region.depth);
  return `${indent}${displayName}`;
}

export function getActiveRegionQuickPickItem({
  activeRegion,
  regionQuickPickItems,
}: {
  activeRegion: Region | undefined;
  regionQuickPickItems: RegionQuickPickItem[];
}): RegionQuickPickItem | undefined {
  return activeRegion
    ? regionQuickPickItems.find(
        (item) => item.startLineIdx === activeRegion.range.start.line
      )
    : regionQuickPickItems[0];
}

/**
 * Whether to scroll the editor to the initially-selected item when the picker
 * opens. Only true when the cursor is genuinely inside a region — opening the
 * picker from outside every region must not move the viewport.
 */
export function shouldPreviewInitialItem({
  activeRegion,
  initialActiveItem,
}: {
  activeRegion: Region | undefined;
  initialActiveItem: RegionQuickPickItem | undefined;
}): boolean {
  return activeRegion !== undefined && initialActiveItem !== undefined;
}

function initializeRegionQuickPick({
  regionQuickPick,
  regionQuickPickItems,
  initialActiveItem,
  activeTextEditor,
  originalVisibleRange,
  previewInitially,
}: {
  regionQuickPick: vscode.QuickPick<RegionQuickPickItem>;
  regionQuickPickItems: RegionQuickPickItem[];
  initialActiveItem: RegionQuickPickItem | undefined;
  activeTextEditor: vscode.TextEditor;
  originalVisibleRange: vscode.Range | undefined;
  previewInitially: boolean;
}): void {
  regionQuickPick.items = regionQuickPickItems;
  regionQuickPick.placeholder = getRegionQuickPickPlaceholder(regionQuickPickItems);
  regionQuickPick.matchOnDescription = true;
  regionQuickPick.canSelectMany = false;
  regionQuickPick.activeItems = initialActiveItem ? [initialActiveItem] : [];

  // Exactly one of accept / hide finalizes the picker; whichever fires first wins.
  let finalized = false;
  const finalize = (finalAction: () => void): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    regionQuickPick.dispose();
    clearHighlightedRegions(activeTextEditor);
    finalAction();
  };

  // Swallow the picker's initial programmatic activation when we must not
  // preview-scroll (cursor outside every region). Genuine user navigation
  // afterwards still previews.
  let suppressInitialPreview = !previewInitially;
  regionQuickPick.onDidChangeActive((items) => {
    if (suppressInitialPreview) {
      suppressInitialPreview = false;
      return;
    }
    previewActiveQuickPickItem({ items, activeTextEditor });
  });

  regionQuickPick.onDidAccept(() => {
    const acceptedItem = regionQuickPick.selectedItems[0];
    finalize(() => {
      if (acceptedItem) {
        moveCursorToFirstNonWhitespaceCharOfLine({
          activeTextEditor,
          lineIdx: acceptedItem.startLineIdx,
          revealType: vscode.TextEditorRevealType.InCenter,
        });
      } else {
        restoreEditorViewport({ activeTextEditor, originalVisibleRange });
      }
    });
  });

  regionQuickPick.onDidHide(() => {
    finalize(() => restoreEditorViewport({ activeTextEditor, originalVisibleRange }));
  });
}

function getRegionQuickPickPlaceholder(regionQuickPickItems: RegionQuickPickItem[]): string {
  return regionQuickPickItems.length > 0
    ? "Search for a region to jump to"
    : "No regions available";
}

/**
 * Restores the editor viewport that was visible before the picker opened. Used
 * on cancel so Escape leaves the editor exactly where it was, instead of
 * recentering on the current cursor line.
 */
export function restoreEditorViewport({
  activeTextEditor,
  originalVisibleRange,
}: {
  activeTextEditor: vscode.TextEditor;
  originalVisibleRange: vscode.Range | undefined;
}): void {
  if (originalVisibleRange) {
    activeTextEditor.revealRange(originalVisibleRange, vscode.TextEditorRevealType.Default);
    return;
  }
  scrollCurrentLineIntoView({
    editor: activeTextEditor,
    revealType: vscode.TextEditorRevealType.InCenter,
  });
}

/**
 * Previews the currently-active picker item, or clears the highlight when the
 * filtered list is empty (zero matches) so no stale region stays highlighted.
 */
export function previewActiveQuickPickItem({
  items,
  activeTextEditor,
}: {
  items: readonly RegionQuickPickItem[];
  activeTextEditor: vscode.TextEditor;
}): void {
  const activeItem = items[0];
  if (!activeItem) {
    clearHighlightedRegions(activeTextEditor);
    return;
  }
  highlightAndScrollItemIntoView({ regionQuickPickItem: activeItem, activeTextEditor });
}

function highlightAndScrollItemIntoView({
  regionQuickPickItem,
  activeTextEditor,
}: {
  regionQuickPickItem: RegionQuickPickItem;
  activeTextEditor: vscode.TextEditor;
}): void {
  const { startLineIdx, endLineIdx } = regionQuickPickItem;
  const range = new vscode.Range(startLineIdx, 0, endLineIdx, 0);
  highlightAndScrollRegionIntoView({
    activeTextEditor,
    range,
    revealType: vscode.TextEditorRevealType.InCenter,
  });
}
