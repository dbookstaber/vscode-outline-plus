import * as vscode from "vscode";
import { extractDocumentIdFromVersioned } from "../lib/getVersionedDocumentId";
import { type FullTreeItem } from "../treeView/fullTreeView/FullTreeItem";
import { generateFullOutlineTreeItems } from "../treeView/fullTreeView/generateTopLevelFullTreeItems";
import { getActiveFullTreeItem } from "../treeView/fullTreeView/getActiveFullTreeItem";
import {
    getFlattenedRegionFullTreeItems,
    getFlattenedSymbolFullTreeItems,
} from "../treeView/fullTreeView/getFlattenedFullTreeItems";
import { type DebouncedFunction, debounce } from "../utils/debounce";
import { log } from "../utils/debugLog";
import { type CollapsibleStateManager } from "./CollapsibleStateManager";
import { type DocumentSymbolStore } from "./DocumentSymbolStore";
import { type RegionStore } from "./RegionStore";

const REFRESH_FULL_OUTLINE_DEBOUNCE_DELAY_MS = 100;
const REFRESH_ACTIVE_ITEM_DEBOUNCE_DELAY_MS = 100;

export class FullOutlineStore implements vscode.Disposable {
  // #region Singleton initialization
  private static _instance: FullOutlineStore | undefined = undefined;

  static initialize(
    regionStore: RegionStore,
    documentSymbolStore: DocumentSymbolStore,
    collapsibleStateManager: CollapsibleStateManager,
    subscriptions: vscode.Disposable[]
  ): FullOutlineStore {
    if (this._instance) {
      throw new Error("FullOutlineStore is already initialized! Only one instance is allowed.");
    }
    this._instance = new FullOutlineStore(
      regionStore,
      documentSymbolStore,
      collapsibleStateManager,
      subscriptions
    );
    subscriptions.push(this._instance);
    return this._instance;
  }

  static getInstance(): FullOutlineStore {
    if (!this._instance) {
      throw new Error("FullOutlineStore is not initialized! Call `initialize()` first.");
    }
    return this._instance;
  }

  /** For testing only: resets the singleton instance. */
  static _resetInstance(): void {
    this._instance = undefined;
  }
  // #endregion

  // #region Public properties
  private _topLevelItems: FullTreeItem[] = [];
  private _onDidChangeFullOutlineItems = new vscode.EventEmitter<void>();
  readonly onDidChangeFullOutlineItems = this._onDidChangeFullOutlineItems.event;
  get topLevelFullOutlineItems(): FullTreeItem[] {
    return this._topLevelItems;
  }

  private _allParentIds = new Set<string>();
  get allParentIds(): Set<string> {
    return this._allParentIds;
  }

  private _activeItem: FullTreeItem | undefined = undefined;
  private _onDidChangeActiveFullOutlineItem = new vscode.EventEmitter<void>();
  readonly onDidChangeActiveFullOutlineItem = this._onDidChangeActiveFullOutlineItem.event;
  get activeFullOutlineItem(): FullTreeItem | undefined {
    return this._activeItem;
  }

  private _documentId: string | undefined = undefined;
  get documentId(): string | undefined {
    return this._documentId;
  }

  private _versionedDocumentId: string | undefined = undefined;
  get versionedDocumentId(): string | undefined {
    return this._versionedDocumentId;
  }

  // #endregion

  private debouncedRefreshFullOutline: DebouncedFunction<() => void> = debounce(
    this.refreshFullOutline.bind(this),
    REFRESH_FULL_OUTLINE_DEBOUNCE_DELAY_MS
  );
  private isRefreshingItems = false;

  private refreshActiveItemTimeout: NodeJS.Timeout | undefined;

  private constructor(
    private regionStore: RegionStore,
    private documentSymbolStore: DocumentSymbolStore,
    private collapsibleStateManager: CollapsibleStateManager,
    subscriptions: vscode.Disposable[]
  ) {
    this.registerListeners(subscriptions);
    this.debouncedRefreshFullOutline();
  }

  dispose(): void {
    this.debouncedRefreshFullOutline.cancel();
    this.clearRefreshActiveItemTimeoutIfExists();
    this._onDidChangeFullOutlineItems.dispose();
    this._onDidChangeActiveFullOutlineItem.dispose();
  }

  /**
   * Forces a complete refresh of both underlying stores and the full outline.
   * This is the nuclear option for recovering from stuck/stale state.
   */
  forceRefresh(): void {
    this.regionStore.forceRefresh();
    this.documentSymbolStore.forceRefresh();
    // The above fire events that trigger debouncedRefreshFullOutline, but we also
    // schedule an immediate refresh in case events don't propagate fast enough.
    this.debouncedRefreshFullOutline.cancel();
    this.refreshFullOutline();
  }

  private registerListeners(subscriptions: vscode.Disposable[]): void {
    vscode.window.onDidChangeActiveTextEditor(
      this.debouncedRefreshFullOutline,
      this,
      subscriptions
    );
    vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this), this, subscriptions);
    this.regionStore.onDidChangeRegions(this.debouncedRefreshFullOutline, this, subscriptions);
    this.documentSymbolStore.onDidChangeDocumentSymbols(
      this.debouncedRefreshFullOutline,
      this,
      subscriptions
    );
    vscode.window.onDidChangeTextEditorSelection(
      this.onSelectionChange.bind(this),
      this,
      subscriptions
    );
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    // RegionStore and DocumentSymbolStore will soon refresh the region and symbol data, at which
    // point we'll refresh the active item with the up-to-date data.
    if (event.document === vscode.window.activeTextEditor?.document) {
      this.clearRefreshActiveItemTimeoutIfExists();
    }
  }

  // #region Refresh Full Outline items
  private refreshFullOutline(): void {
    const regionStoreVersionedDocumentId = this.regionStore.versionedDocumentId;
    const documentSymbolStoreVersionedDocumentId = this.documentSymbolStore.versionedDocumentId;

    // If both stores refer to different documents entirely (not just different versions
    // of the same document), wait for them to converge.
    if (regionStoreVersionedDocumentId !== undefined && documentSymbolStoreVersionedDocumentId !== undefined) {
      const regionDocId = extractDocumentIdFromVersioned(regionStoreVersionedDocumentId);
      const symbolDocId = extractDocumentIdFromVersioned(documentSymbolStoreVersionedDocumentId);
      if (regionDocId !== symbolDocId) {
        // Stores are looking at different documents — wait for convergence.
        log(`FullOutlineStore: skipping refresh — stores on different documents (region=${regionDocId}, symbol=${symbolDocId})`);
        return;
      }
    }

    // Use whichever versioned ID is most current. The RegionStore updates synchronously
    // and is typically ahead of the async DocumentSymbolStore. We refresh with whatever
    // data is available rather than blocking on an exact version match, because blocking
    // can leave the outline permanently stale during rapid edits.
    this._documentId = this.regionStore.documentId;
    this._versionedDocumentId = regionStoreVersionedDocumentId ?? documentSymbolStoreVersionedDocumentId;
    this.refreshItems();
    this.refreshActiveItem();
  }

  private refreshItems(): void {
    this.isRefreshingItems = true;
    try {
      const flattenedRegionItems = getFlattenedRegionFullTreeItems(this.regionStore.flattenedRegions);
      // Pass the active document for modifier extraction
      const activeDocument = vscode.window.activeTextEditor?.document;
      const flattenedSymbolItems = getFlattenedSymbolFullTreeItems(
        this.documentSymbolStore.flattenedDocumentSymbols,
        activeDocument
      );
      // Sort both flattened lists by start position before merging.
      // This is necessary because the flattening produces depth-first order,
      // but the merge algorithm in generateFullOutlineTreeItems expects
      // items to be sorted by start position for correct interleaving.
      sortFullTreeItemsByStart(flattenedRegionItems);
      sortFullTreeItemsByStart(flattenedSymbolItems);
      const { topLevelItems, allParentIds } = generateFullOutlineTreeItems({
        flattenedRegionItems,
        flattenedSymbolItems,
        collapsibleStateManager: this.collapsibleStateManager,
        documentId: this._documentId,
      });
      this._topLevelItems = topLevelItems;
      this._allParentIds = allParentIds;
      this._onDidChangeFullOutlineItems.fire();
    } finally {
      this.isRefreshingItems = false;
    }
  }
  // #endregion

  // #region Refresh active item on selection change
  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (this.isRefreshingItems) {
      return;
    }
    if (event.textEditor === vscode.window.activeTextEditor) {
      this.debouncedRefreshActiveItem();
    }
  }

  private debouncedRefreshActiveItem(): void {
    this.clearRefreshActiveItemTimeoutIfExists();
    this.refreshActiveItemTimeout = setTimeout(
      this.refreshActiveItem.bind(this),
      REFRESH_ACTIVE_ITEM_DEBOUNCE_DELAY_MS
    );
  }

  private refreshActiveItem(): void {
    this.clearRefreshActiveItemTimeoutIfExists();
    const cursorPosition = vscode.window.activeTextEditor?.selection.active;
    if (!cursorPosition) {
      return;
    }
    const oldActiveItem = this._activeItem;
    this._activeItem = getActiveFullTreeItem(this._topLevelItems, cursorPosition);
    if (this._activeItem !== oldActiveItem) {
      this._onDidChangeActiveFullOutlineItem.fire();
    }
  }

  private clearRefreshActiveItemTimeoutIfExists(): void {
    if (this.refreshActiveItemTimeout) {
      clearTimeout(this.refreshActiveItemTimeout);
      this.refreshActiveItemTimeout = undefined;
    }
  }
  // #endregion
}

// #region Helper functions

/**
 * Sorts an array of FullTreeItems in place by their start position.
 * This ensures that the merge algorithm in generateFullOutlineTreeItems
 * correctly interleaves items from different sources (regions and symbols).
 */
function sortFullTreeItemsByStart(items: FullTreeItem[]): void {
  items.sort((a, b) => a.range.start.compareTo(b.range.start));
}

// #endregion
