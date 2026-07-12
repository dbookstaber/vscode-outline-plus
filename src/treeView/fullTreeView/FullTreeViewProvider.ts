import { type Disposable } from "vscode";
import { getGlobalFullOutlineViewConfigValue } from "../../config/config";
import { type CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { type FullOutlineStore } from "../../state/FullOutlineStore";
import { type OutlineStoreAdapter, OutlineTreeViewProvider } from "../OutlineTreeViewProvider";
import { type FullTreeItem } from "./FullTreeItem";

/**
 * Tree data provider for the Full Outline view. All behavior lives in
 * {@link OutlineTreeViewProvider}; this subclass only bridges the
 * {@link FullOutlineStore} into the base's {@link OutlineStoreAdapter}.
 */
export class FullTreeViewProvider extends OutlineTreeViewProvider<FullTreeItem> {
  constructor(
    fullOutlineStore: FullOutlineStore,
    collapsibleStateManager: CollapsibleStateManager,
    subscriptions: Disposable[]
  ) {
    super(createFullOutlineAdapter(fullOutlineStore), collapsibleStateManager, subscriptions);
  }
}

function createFullOutlineAdapter(store: FullOutlineStore): OutlineStoreAdapter<FullTreeItem> {
  return {
    get activeItem(): FullTreeItem | undefined {
      return store.activeFullOutlineItem;
    },
    get topLevelItems(): FullTreeItem[] {
      return store.topLevelFullOutlineItems;
    },
    get documentId(): string | undefined {
      return store.documentId;
    },
    get allParentIds(): Set<string> {
      return store.allParentIds;
    },
    onDidChangeItems: store.onDidChangeFullOutlineItems,
    onDidChangeActiveItem: store.onDidChangeActiveFullOutlineItem,
    shouldAutoHighlight: () => getGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem"),
    createTreeItem: (element, collapsibleState): FullTreeItem => {
      // Update collapsible state from saved state or default based on children
      element.collapsibleState = collapsibleState;
      return element;
    },
  };
}
