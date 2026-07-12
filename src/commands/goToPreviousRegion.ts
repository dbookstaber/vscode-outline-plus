import * as vscode from "vscode";
import { getPreviousRegion } from "../lib/getPreviousRegion";
import { moveCursorToRegion } from "../utils/editorNav";
import { showRegionCommandNoOp } from "./regionCommandFeedback";
import { type OutlinePlusClosuredParams } from "./registerCommand";

export function goToPreviousRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { flattenedRegions } = regionStore;
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    showRegionCommandNoOp("noEditor");
    return;
  }
  const cursorLineIdx = activeTextEditor.selection.active.line;
  const maybePreviousRegion = getPreviousRegion(flattenedRegions, cursorLineIdx);
  if (!maybePreviousRegion) {
    showRegionCommandNoOp(flattenedRegions.length === 0 ? "noRegions" : "noPreviousRegion");
    return;
  }
  moveCursorToRegion({
    activeTextEditor,
    region: maybePreviousRegion,
    revealType: vscode.TextEditorRevealType.Default,
  });
}
