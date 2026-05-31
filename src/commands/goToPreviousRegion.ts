import * as vscode from "vscode";
import { CMD_GO_TO_PREVIOUS_REGION } from "../constants";
import { getPreviousRegion } from "../lib/getPreviousRegion";
import { moveCursorToRegion } from "../lib/moveCursorToRegion";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

export const goToPreviousRegionCommand: OutlinePlusClosuredCommand = {
  id: CMD_GO_TO_PREVIOUS_REGION,
  callback: goToPreviousRegion,
  needsRegionHelperParams: true,
};

function goToPreviousRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { flattenedRegions } = regionStore;
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }
  const cursorLineIdx = activeTextEditor.selection.active.line;
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
