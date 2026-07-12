import * as vscode from "vscode";
import { getNextRegion } from "../lib/getNextRegion";
import { moveCursorToRegion } from "../utils/editorNav";
import { showRegionCommandNoOp } from "./regionCommandFeedback";
import { type OutlinePlusClosuredParams } from "./registerCommand";

export function goToNextRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { flattenedRegions } = regionStore;
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    showRegionCommandNoOp("noEditor");
    return;
  }
  const cursorLineIdx = activeTextEditor.selection.active.line;
  const maybeNextRegion = getNextRegion(flattenedRegions, cursorLineIdx);
  if (!maybeNextRegion) {
    showRegionCommandNoOp(flattenedRegions.length === 0 ? "noRegions" : "noNextRegion");
    return;
  }
  moveCursorToRegion({
    activeTextEditor,
    region: maybeNextRegion,
    revealType: vscode.TextEditorRevealType.Default,
  });
}
