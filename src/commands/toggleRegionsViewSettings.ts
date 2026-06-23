import {
    setGlobalRegionsViewConfigValue,
} from "../config/regionsViewConfig";
import {
    CMD_REGIONS_VIEW_START_AUTO_HIGHLIGHT,
    CMD_REGIONS_VIEW_STOP_AUTO_HIGHLIGHT,
} from "../constants";
import { type OutlinePlusNonClosuredCommand } from "./registerCommand";

// #region Exported commands

const stopAutoHighlightingActiveRegionCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_REGIONS_VIEW_STOP_AUTO_HIGHLIGHT,
  callback: stopAutoHighlightingActiveRegion,
  needsRegionHelperParams: false,
};

const startAutoHighlightingActiveRegionCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_REGIONS_VIEW_START_AUTO_HIGHLIGHT,
  callback: startAutoHighlightingActiveRegion,
  needsRegionHelperParams: false,
};

export const allRegionsViewConfigCommands: OutlinePlusNonClosuredCommand[] = [
  stopAutoHighlightingActiveRegionCommand,
  startAutoHighlightingActiveRegionCommand,
];

// #endregion

// #region Command implementations

function stopAutoHighlightingActiveRegion(): void {
  void setGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion", false);
}

function startAutoHighlightingActiveRegion(): void {
  void setGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion", true);
}

// #endregion
