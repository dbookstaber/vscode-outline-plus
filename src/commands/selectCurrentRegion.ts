import * as vscode from "vscode";
import { CMD_SELECT_CURRENT_REGION } from "../constants";
import { getActiveRegionInEditor } from "../utils/getActiveRegion";
import { selectRange } from "../utils/selectionUtils";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

export const selectCurrentRegionCommand: OutlinePlusClosuredCommand = {
  id: CMD_SELECT_CURRENT_REGION,
  callback: selectCurrentRegion,
  needsRegionHelperParams: true,
};

function selectCurrentRegion({ regionStore }: OutlinePlusClosuredParams): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return;
  }

  const { topLevelRegions } = regionStore;
  const currentActiveRegion = getActiveRegionInEditor(topLevelRegions, activeTextEditor);
  if (!currentActiveRegion) {
    return;
  }
  selectRange({ activeTextEditor, range: currentActiveRegion.range });
}
