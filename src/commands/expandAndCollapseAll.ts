import {
    CMD_FULL_OUTLINE_VIEW_EXPAND_ALL,
    CMD_REGIONS_VIEW_EXPAND_ALL,
} from "../constants";
import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

// #region Exported commands

const expandAllRegionTreeItemsCommand: OutlinePlusClosuredCommand = {
  id: CMD_REGIONS_VIEW_EXPAND_ALL,
  callback: expandAllRegionTreeItems,
  needsRegionHelperParams: true,
};

const expandAllFullOutlineItemsCommand: OutlinePlusClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_EXPAND_ALL,
  callback: expandAllFullOutlineItems,
  needsRegionHelperParams: true,
};

export const allExpandAllCommands = [
  expandAllRegionTreeItemsCommand,
  expandAllFullOutlineItemsCommand,
];

// #endregion

// #region Command implementations

function expandAllRegionTreeItems({ regionTreeViewProvider }: OutlinePlusClosuredParams): void {
  regionTreeViewProvider.expandAllTreeItems();
}

function expandAllFullOutlineItems({ fullTreeViewProvider }: OutlinePlusClosuredParams): void {
  fullTreeViewProvider.expandAllTreeItems();
}

// #endregion
