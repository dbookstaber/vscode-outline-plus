import {
    type OutlinePlusClosuredCommand,
    type OutlinePlusClosuredParams,
} from "./registerCommand";

// #region Exported commands

const expandAllRegionTreeItemsCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.regionsView.expandAll",
  callback: expandAllRegionTreeItems,
  needsRegionHelperParams: true,
};

const expandAllFullOutlineItemsCommand: OutlinePlusClosuredCommand = {
  id: "outlinePlus.fullOutlineView.expandAll",
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
