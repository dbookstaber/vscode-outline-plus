import * as vscode from "vscode";
import { getActiveRegionInEditor } from "../utils/getActiveRegion";
import { selectRange } from "../utils/editorNav";
import { showRegionCommandNoOp } from "./regionCommandFeedback";
import { type OutlinePlusClosuredParams } from "./registerCommand";

export function selectCurrentRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    showRegionCommandNoOp("noEditor");
    return;
  }

  const { topLevelRegions } = regionStore;
  const currentActiveRegion = getActiveRegionInEditor(topLevelRegions, activeTextEditor);
  if (!currentActiveRegion) {
    showRegionCommandNoOp(topLevelRegions.length === 0 ? "noRegions" : "cursorOutsideRegion");
    return;
  }
  selectRange({ activeTextEditor, range: currentActiveRegion.range });
}
