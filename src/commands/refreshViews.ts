import {
    type RegionHelperClosuredCommand,
    type RegionHelperClosuredParams,
} from "./registerCommand";

// #region Exported commands

const refreshRegionsViewCommand: RegionHelperClosuredCommand = {
  id: "regionHelper.regionsView.refresh",
  callback: refreshRegionsView,
  needsRegionHelperParams: true,
};

const refreshFullOutlineViewCommand: RegionHelperClosuredCommand = {
  id: "regionHelper.fullOutlineView.refresh",
  callback: refreshFullOutlineView,
  needsRegionHelperParams: true,
};

export const allRefreshCommands = [refreshRegionsViewCommand, refreshFullOutlineViewCommand];

// #endregion

// #region Command implementations

function refreshRegionsView({ regionStore }: RegionHelperClosuredParams): void {
  regionStore.forceRefresh();
}

function refreshFullOutlineView({ fullOutlineStore }: RegionHelperClosuredParams): void {
  fullOutlineStore.forceRefresh();
}

// #endregion
