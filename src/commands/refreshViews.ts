import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

// #region Exported commands

const refreshRegionsViewCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.regionsView.refresh",
  callback: refreshRegionsView,
  needsRegionHelperParams: true,
};

const refreshFullOutlineViewCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.fullOutlineView.refresh",
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
