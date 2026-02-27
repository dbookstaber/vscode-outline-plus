import type * as vscode from "vscode";
import { moveCursorToPosition } from "./moveCursorToPosition";

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
  const firstCharIdx = getFirstNonWhitespaceCharacterIndex(activeTextEditor, clampedLine);
  moveCursorToPosition({
    activeTextEditor,
    lineIdx: clampedLine,
    character: firstCharIdx,
    revealType,
  });
}

function getFirstNonWhitespaceCharacterIndex(editor: vscode.TextEditor, lineIdx: number): number {
  const line = editor.document.lineAt(lineIdx);
  return line.firstNonWhitespaceCharacterIndex;
}
