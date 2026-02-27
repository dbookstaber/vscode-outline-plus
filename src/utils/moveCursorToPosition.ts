import * as vscode from "vscode";

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
