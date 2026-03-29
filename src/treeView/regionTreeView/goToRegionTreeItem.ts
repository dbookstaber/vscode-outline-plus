import * as vscode from "vscode";
import { type OutlinePlusNonClosuredCommand } from "../../commands/registerCommand";
import { focusActiveEditorGroup } from "../../utils/focusEditor";
import { moveCursorToFirstNonWhitespaceCharOfLine } from "../../utils/moveCursorToFirstNonWhitespaceOfLine";

export const goToRegionTreeItemCommand: OutlinePlusNonClosuredCommand = {
  id: "outlinePlus.goToRegionTreeItem",
  callback: goToRegionTreeItem,
  needsRegionHelperParams: false,
};

function goToRegionTreeItem(startLineIdx: number): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  moveCursorToFirstNonWhitespaceCharOfLine({
    activeTextEditor,
    lineIdx: startLineIdx,
    revealType: vscode.TextEditorRevealType.InCenterIfOutsideViewport,
  });
  void focusActiveEditorGroup();
}
