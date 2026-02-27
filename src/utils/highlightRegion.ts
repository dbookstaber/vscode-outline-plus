import * as vscode from "vscode";
import { scrollLineIntoView } from "./scrollUtils";

let decorationType: vscode.TextEditorDecorationType | undefined;

function getDecorationType(): vscode.TextEditorDecorationType {
  decorationType ??= vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("editor.findMatchHighlightBackground"),
  });
  return decorationType;
}

export function disposeHighlightDecorationType(): void {
  decorationType?.dispose();
  decorationType = undefined;
}

export function highlightAndScrollRegionIntoView({
  activeTextEditor,
  range,
  revealType,
}: {
  activeTextEditor: vscode.TextEditor;
  range: vscode.Range;
  revealType: vscode.TextEditorRevealType;
}): void {
  highlightRegion({ activeTextEditor, range });
  scrollLineIntoView({ editor: activeTextEditor, lineIdx: range.start.line, revealType });
}

export function highlightRegion({
  activeTextEditor,
  range,
}: {
  activeTextEditor: vscode.TextEditor;
  range: vscode.Range;
}): void {
  activeTextEditor.setDecorations(getDecorationType(), [
    {
      range: new vscode.Range(range.start.line, 0, range.end.line + 1, 0),
    },
  ]);
}

export function clearHighlightedRegions(activeTextEditor: vscode.TextEditor): void {
  activeTextEditor.setDecorations(getDecorationType(), []);
}
