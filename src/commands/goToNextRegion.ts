import * as vscode from "vscode";
import { getNextRegion } from "../lib/getNextRegion";
import { moveCursorToRegion } from "../lib/moveCursorToRegion";
import { getActiveCursorLineIdx } from "../utils/getActiveCursorLineIdx";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

export const goToNextRegionCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.goToNextRegion",
  callback: goToNextRegion,
  needsRegionHelperParams: true,
};

function goToNextRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { flattenedRegions } = regionStore;
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  const cursorLineIdx = getActiveCursorLineIdx(activeTextEditor);
  const maybeNextRegion = getNextRegion(flattenedRegions, cursorLineIdx);
  if (!maybeNextRegion) {
    return;
  }
  moveCursorToRegion({
    activeTextEditor,
    region: maybeNextRegion,
    revealType: vscode.TextEditorRevealType.Default,
  });
}
