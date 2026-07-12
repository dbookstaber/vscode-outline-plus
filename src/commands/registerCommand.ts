import * as vscode from "vscode";
import {
    CMD_FULL_OUTLINE_VIEW_EXPAND_ALL,
    CMD_FULL_OUTLINE_VIEW_REFRESH,
    CMD_FULL_OUTLINE_VIEW_START_AUTO_HIGHLIGHT,
    CMD_FULL_OUTLINE_VIEW_STOP_AUTO_HIGHLIGHT,
    CMD_GO_TO_FULL_TREE_ITEM,
    CMD_GO_TO_NEXT_REGION,
    CMD_GO_TO_PREVIOUS_REGION,
    CMD_GO_TO_REGION_BOUNDARY,
    CMD_GO_TO_REGION_FROM_QUICK_PICK,
    CMD_REGIONS_VIEW_EXPAND_ALL,
    CMD_REGIONS_VIEW_REFRESH,
    CMD_REGIONS_VIEW_START_AUTO_HIGHLIGHT,
    CMD_REGIONS_VIEW_STOP_AUTO_HIGHLIGHT,
    CMD_SELECT_CURRENT_REGION,
} from "../constants";
import { type FullOutlineStore } from "../state/FullOutlineStore";
import { type RegionStore } from "../state/RegionStore";
import { type FullTreeViewProvider } from "../treeView/fullTreeView/FullTreeViewProvider";
import { goToTreeItem } from "../treeView/fullTreeView/goToFullTreeItem";
import { type RegionTreeViewProvider } from "../treeView/regionTreeView/RegionTreeViewProvider";
import { expandAllFullOutlineItems, expandAllRegionTreeItems } from "./expandAndCollapseAll";
import { goToNextRegion } from "./goToNextRegion";
import { goToPreviousRegion } from "./goToPreviousRegion";
import { goToRegionBoundary } from "./goToRegionBoundary";
import { goToRegionFromQuickPick } from "./goToRegionFromQuickPick";
import {
    startAutoHighlightingActiveItem,
    startAutoHighlightingActiveRegion,
    stopAutoHighlightingActiveItem,
    stopAutoHighlightingActiveRegion,
} from "./autoHighlightToggles";
import { refreshFullOutlineView, refreshRegionsView } from "./refreshViews";
import { selectCurrentRegion } from "./selectCurrentRegion";

/** The extension's stores/providers that most commands close over. */
export type OutlinePlusClosuredParams = {
  regionStore: RegionStore;
  fullOutlineStore: FullOutlineStore;
  regionTreeViewProvider: RegionTreeViewProvider;
  fullTreeViewProvider: FullTreeViewProvider;
};

export function registerAllCommands(
  subscriptions: vscode.Disposable[],
  params: OutlinePlusClosuredParams
): void {
  const register = (
    id: string,
    callback: Parameters<typeof vscode.commands.registerCommand>[1]
  ): void => {
    subscriptions.push(vscode.commands.registerCommand(id, callback));
  };

  // The Full Outline and Regions tree items both invoke this command with their
  // item id (from `command.arguments`); it resolves the current position from the
  // live stores in `params` at click time.
  register(CMD_GO_TO_FULL_TREE_ITEM, (itemId: string) => goToTreeItem(itemId, params));

  // The remaining commands take no VS Code arguments; they close over the
  // extension's stores/providers instead.
  register(CMD_GO_TO_REGION_BOUNDARY, () => goToRegionBoundary(params));
  register(CMD_SELECT_CURRENT_REGION, () => selectCurrentRegion(params));
  register(CMD_GO_TO_REGION_FROM_QUICK_PICK, () => goToRegionFromQuickPick(params));
  register(CMD_GO_TO_NEXT_REGION, () => goToNextRegion(params));
  register(CMD_GO_TO_PREVIOUS_REGION, () => goToPreviousRegion(params));
  register(CMD_REGIONS_VIEW_EXPAND_ALL, () => expandAllRegionTreeItems(params));
  register(CMD_FULL_OUTLINE_VIEW_EXPAND_ALL, () => expandAllFullOutlineItems(params));
  register(CMD_REGIONS_VIEW_REFRESH, () => refreshRegionsView(params));
  register(CMD_FULL_OUTLINE_VIEW_REFRESH, () => refreshFullOutlineView(params));

  // Auto-highlight toggles are parameterless.
  register(CMD_REGIONS_VIEW_START_AUTO_HIGHLIGHT, startAutoHighlightingActiveRegion);
  register(CMD_REGIONS_VIEW_STOP_AUTO_HIGHLIGHT, stopAutoHighlightingActiveRegion);
  register(CMD_FULL_OUTLINE_VIEW_START_AUTO_HIGHLIGHT, startAutoHighlightingActiveItem);
  register(CMD_FULL_OUTLINE_VIEW_STOP_AUTO_HIGHLIGHT, stopAutoHighlightingActiveItem);
}
