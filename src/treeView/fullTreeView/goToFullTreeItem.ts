import * as vscode from "vscode";
import { type OutlinePlusClosuredParams } from "../../commands/registerCommand";
import {
    focusActiveEditorGroup,
    moveCursorToFirstNonWhitespaceCharOfLine,
    moveCursorToPosition,
} from "../../utils/editorNav";
import { type FullTreeItem } from "./FullTreeItem";

type NavTarget = { line: number; character: number | undefined };

/**
 * Shared "go to tree item" command for both the Full Outline and Regions views.
 *
 * The item's position is resolved *at click time* from the live stores (by id)
 * rather than baked into the tree item's `command.arguments` at build time, so a
 * click on a row that is momentarily stale relative to the document (debounce
 * window, slow symbol provider) still navigates to the item's current position.
 * `goToRegionTreeItem` was a strict subset of this and has been removed (plan 3.7).
 */
export function goToTreeItem(itemId: string, params: OutlinePlusClosuredParams): void {
  const target = resolveNavTarget(itemId, params);
  if (target === undefined) {
    return;
  }
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  if (target.character === undefined) {
    moveCursorToFirstNonWhitespaceCharOfLine({
      activeTextEditor,
      lineIdx: target.line,
      revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    });
  } else {
    moveCursorToPosition({
      activeTextEditor,
      lineIdx: target.line,
      character: target.character,
      revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    });
  }
  void focusActiveEditorGroup();
}

function resolveNavTarget(
  itemId: string,
  { fullOutlineStore, regionStore }: OutlinePlusClosuredParams
): NavTarget | undefined {
  const fullItem = findFullTreeItemById(fullOutlineStore.topLevelFullOutlineItems, itemId);
  if (fullItem !== undefined) {
    // For symbols prefer the name's range (`selectionRange`) over the decorated
    // definition range; regions have no selectionRange and navigate line-first.
    const navRange =
      fullItem.itemType === "symbol" && fullItem.selectionRange !== undefined
        ? fullItem.selectionRange
        : fullItem.range;
    return {
      line: navRange.start.line,
      character: fullItem.itemType === "symbol" ? navRange.start.character : undefined,
    };
  }
  const region = regionStore.flattenedRegions.find((candidate) => candidate.id === itemId);
  if (region !== undefined) {
    return { line: region.range.start.line, character: undefined };
  }
  return undefined;
}

function findFullTreeItemById(items: FullTreeItem[], itemId: string): FullTreeItem | undefined {
  for (const item of items) {
    if (item.id === itemId) {
      return item;
    }
    const found = findFullTreeItemById(item.children, itemId);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
