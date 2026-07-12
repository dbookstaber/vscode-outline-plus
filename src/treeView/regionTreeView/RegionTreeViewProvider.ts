import { type Disposable } from "vscode";
import { getGlobalRegionsViewConfigValue } from "../../config/config";
import { type Region } from "../../models/Region";
import { type CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { type RegionStore } from "../../state/RegionStore";
import { type OutlineStoreAdapter, OutlineTreeViewProvider } from "../OutlineTreeViewProvider";
import { RegionTreeItem } from "./RegionTreeItem";

/**
 * Tree data provider for the Regions view. All behavior lives in
 * {@link OutlineTreeViewProvider}; this subclass only bridges the
 * {@link RegionStore} into the base's {@link OutlineStoreAdapter}.
 */
export class RegionTreeViewProvider extends OutlineTreeViewProvider<Region> {
  constructor(
    regionStore: RegionStore,
    collapsibleStateManager: CollapsibleStateManager,
    subscriptions: Disposable[]
  ) {
    super(createRegionAdapter(regionStore), collapsibleStateManager, subscriptions);
  }
}

function createRegionAdapter(store: RegionStore): OutlineStoreAdapter<Region> {
  return {
    get activeItem(): Region | undefined {
      return store.activeRegion;
    },
    get topLevelItems(): Region[] {
      return store.topLevelRegions;
    },
    get documentId(): string | undefined {
      return store.documentId;
    },
    get allParentIds(): Set<string> {
      return store.allParentIds;
    },
    onDidChangeItems: store.onDidChangeRegions,
    onDidChangeActiveItem: store.onDidChangeActiveRegion,
    shouldAutoHighlight: () => getGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion"),
    createTreeItem: (region, collapsibleState) =>
      new RegionTreeItem(region, collapsibleState, store.documentId),
  };
}
