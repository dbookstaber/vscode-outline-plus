import * as vscode from "vscode";
import { type OutlinePlusNonClosuredCommand } from "../../commands/registerCommand";
import { CMD_GO_TO_FULL_TREE_ITEM } from "../../constants";
import { throwNever } from "../../utils/errorUtils";
import { focusActiveEditorGroup } from "../../utils/focusEditor";
import { moveCursorToFirstNonWhitespaceCharOfLine } from "../../utils/moveCursorToFirstNonWhitespaceOfLine";
import { moveCursorToPosition } from "../../utils/moveCursorToPosition";
import { type FullTreeItemType } from "./FullTreeItem";

export const goToFullTreeItemCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_GO_TO_FULL_TREE_ITEM,
  callback: goToFullTreeItem,
  needsRegionHelperParams: false,
};

function goToFullTreeItem(startLineIdx: number, startCharacter: number | undefined): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  if (startCharacter === undefined) {
    moveCursorToFirstNonWhitespaceCharOfLine({
      activeTextEditor,
      lineIdx: startLineIdx,
      revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    });
  } else {
    moveCursorToPosition({
      activeTextEditor,
      lineIdx: startLineIdx,
      character: startCharacter,
      revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport,
    });
  }
  void focusActiveEditorGroup();
}

export function makeGoToFullTreeItemCommand(
  itemType: FullTreeItemType,
  range: vscode.Range,
  selectionRange?: vscode.Range
): vscode.Command {
  // For symbols, prefer `selectionRange.start` (the name's location) over `range.start`
  // (which for decorated definitions like Python `@staticmethod\ndef foo()` points at the
  // decorator line, not the `def`). Regions don't supply a selectionRange.
  const navRange = itemType === "symbol" && selectionRange !== undefined ? selectionRange : range;
  return {
    command: goToFullTreeItemCommand.id,
    title: "Go to Item",
    arguments: [navRange.start.line, getTargetCharacter(itemType, navRange)],
  };
}

function getTargetCharacter(itemType: FullTreeItemType, range: vscode.Range): number | undefined {
  switch (itemType) {
    case "region":
      // Just go to the first non-whitespace character of the line
      return undefined;
    case "symbol":
      return range.start.character;
    default:
      throwNever(itemType);
  }
}
