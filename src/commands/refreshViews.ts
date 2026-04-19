import {
    CMD_FULL_OUTLINE_VIEW_REFRESH,
    CMD_REGIONS_VIEW_REFRESH,
} from "../constants";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

// #region Exported commands

const refreshRegionsViewCommand: OutlinePlusClosuredCommand = {
  id: CMD_REGIONS_VIEW_REFRESH,
  callback: refreshRegionsView,
  needsRegionHelperParams: true,
};

const refreshFullOutlineViewCommand: OutlinePlusClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_REFRESH,
  callback: refreshFullOutlineView,
  needsRegionHelperParams: true,
};

export const allRefreshCommands = [refreshRegionsViewCommand, refreshFullOutlineViewCommand];

// #endregion

// #region Command implementations

function refreshRegionsView({ regionStore }: OutlinePlusClosuredParams): void {
  regionStore.forceRefresh();
}

function refreshFullOutlineView({ fullOutlineStore }: OutlinePlusClosuredParams): void {
  fullOutlineStore.forceRefresh();
}

// #endregion
