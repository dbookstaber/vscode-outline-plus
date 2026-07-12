import * as vscode from "vscode";
import { type Region } from "../models/Region";

/**
 * Editor-navigation helpers shared by the tree views and region commands:
 * moving the cursor, scrolling a line into view, selecting a range, and focusing
 * the editor group. Consolidated from the former moveCursorToPosition /
 * moveCursorToFirstNonWhitespaceOfLine / scrollUtils / selectionUtils /
 * focusEditor / lib/moveCursorToRegion modules (plan 3.9).
 */

export function moveCursorToPosition({
  activeTextEditor,
  lineIdx,
  character,
  revealType,
}: {
  activeTextEditor: vscode.TextEditor;
  lineIdx: number;
  character: number;
  revealType: vscode.TextEditorRevealType;
}): void {
  const lastLine = activeTextEditor.document.lineCount - 1;
  const clampedLine = Math.max(0, Math.min(lineIdx, lastLine));
  const lineLength = activeTextEditor.document.lineAt(clampedLine).text.length;
  const clampedChar = Math.max(0, Math.min(character, lineLength));
  const position = new vscode.Position(clampedLine, clampedChar);
  const selection = new vscode.Selection(position, position);
  activeTextEditor.selection = selection;
  activeTextEditor.revealRange(selection, revealType);
}

export function moveCursorToFirstNonWhitespaceCharOfLine({
  activeTextEditor,
  lineIdx,
  revealType,
}: {
  activeTextEditor: vscode.TextEditor;
  lineIdx: number;
  revealType: vscode.TextEditorRevealType;
}): void {
  const lastLine = activeTextEditor.document.lineCount - 1;
  const clampedLine = Math.max(0, Math.min(lineIdx, lastLine));
  const firstCharIdx = activeTextEditor.document.lineAt(clampedLine).firstNonWhitespaceCharacterIndex;
  moveCursorToPosition({
    activeTextEditor,
    lineIdx: clampedLine,
    character: firstCharIdx,
    revealType,
  });
}

export function moveCursorToRegion({
  activeTextEditor,
  region,
  revealType,
}: {
  activeTextEditor: vscode.TextEditor;
  region: Region;
  revealType: vscode.TextEditorRevealType;
}): void {
  moveCursorToFirstNonWhitespaceCharOfLine({
    activeTextEditor,
    lineIdx: region.range.start.line,
    revealType,
  });
}

export function scrollCurrentLineIntoView({
  editor,
  revealType,
}: {
  editor: vscode.TextEditor;
  revealType: vscode.TextEditorRevealType;
}): void {
  scrollLineIntoView({ editor, lineIdx: editor.selection.active.line, revealType });
}

export function scrollLineIntoView({
  editor,
  lineIdx,
  revealType,
}: {
  editor: vscode.TextEditor;
  lineIdx: number;
  revealType: vscode.TextEditorRevealType;
}): void {
  const position = new vscode.Position(lineIdx, 0);
  editor.revealRange(new vscode.Range(position, position), revealType);
}

export function selectRange({
  activeTextEditor,
  range,
}: {
  activeTextEditor: vscode.TextEditor;
  range: vscode.Range;
}): void {
  const selectionRange = new vscode.Selection(
    range.start.line,
    range.start.character,
    range.end.line,
    range.end.character
  );
  activeTextEditor.selection = selectionRange;
  activeTextEditor.revealRange(selectionRange, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}

/** Focuses the active editor group. */
export async function focusActiveEditorGroup(): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
}
