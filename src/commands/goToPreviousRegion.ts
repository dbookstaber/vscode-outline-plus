import * as vscode from "vscode";
import { getPreviousRegion } from "../lib/getPreviousRegion";
import { moveCursorToRegion } from "../lib/moveCursorToRegion";
import { getActiveCursorLineIdx } from "../utils/getActiveCursorLineIdx";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

export const goToPreviousRegionCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.goToPreviousRegion",
  callback: goToPreviousRegion,
  needsRegionHelperParams: true,
};

function goToPreviousRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { flattenedRegions } = regionStore;
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  const cursorLineIdx = getActiveCursorLineIdx(activeTextEditor);
  const maybePreviousRegion = getPreviousRegion(flattenedRegions, cursorLineIdx);
  if (!maybePreviousRegion) {
    return;
  }
  moveCursorToRegion({
    activeTextEditor,
    region: maybePreviousRegion,
    revealType: vscode.TextEditorRevealType.Default,
  });
}
