import * as vscode from "vscode";
import { DEBOUNCE_CURSOR_TRACKING_MS, DEBOUNCE_DOCUMENT_PARSE_MS } from "../constants";
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

export class FullOutlineStore implements vscode.Disposable {
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
    DEBOUNCE_DOCUMENT_PARSE_MS
  );
  private isRefreshingItems = false;

  /**
   * Counts consecutive convergence-failed refresh attempts. Reset to 0 on a
   * successful (mismatch-free) refresh. Bounds the self-retry path in
   * {@link refreshFullOutline} so a permanently-stuck downstream store cannot
   * cause an infinite 250-ms retry loop.
   */
  private convergenceRetryCount = 0;
  private static readonly MAX_CONVERGENCE_RETRIES = 3;

  private refreshActiveItemTimeout: NodeJS.Timeout | undefined;

  constructor(
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
   *
   * We do NOT synchronously call `refreshFullOutline()` here. Both store
   * `forceRefresh()` calls fire `onDidChange*` events that trigger
   * `debouncedRefreshFullOutline`; running a sync refresh in between would
   * proceed with stale symbol data (DocumentSymbolStore's fetch is async),
   * fire `onDidChangeFullOutlineItems`, then fire again when the symbols
   * arrive — a double-fire visible as two tree refreshes on each Refresh
   * button click. Relying on the event chain gives one refresh with current
   * data once both stores have settled.
   */
  forceRefresh(): void {
    this.debouncedRefreshFullOutline.cancel();
    this.regionStore.forceRefresh();
    this.documentSymbolStore.forceRefresh();
  }

  private registerListeners(subscriptions: vscode.Disposable[]): void {
    vscode.window.onDidChangeActiveTextEditor(
      this.onActiveTextEditorChanged.bind(this),
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

  /**
   * Editor change is a fresh convergence cycle — reset the bounded-retry
   * counter so a prior file's stuck retry state cannot prematurely make us
   * give up on the new file's convergence.
   */
  private onActiveTextEditorChanged(): void {
    this.convergenceRetryCount = 0;
    this.debouncedRefreshFullOutline();
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
        // Schedule a bounded self-retry on the debounced refresh; if we don't,
        // the outline can stick to the previous file until the next change
        // event. Bounded so a permanently-stuck downstream store cannot trap
        // us in a 250-ms retry loop forever.
        if (this.convergenceRetryCount < FullOutlineStore.MAX_CONVERGENCE_RETRIES) {
          this.convergenceRetryCount += 1;
          log(`FullOutlineStore: skipping refresh — stores on different documents (region=${regionDocId}, symbol=${symbolDocId}); retry ${this.convergenceRetryCount}/${FullOutlineStore.MAX_CONVERGENCE_RETRIES}`);
          this.debouncedRefreshFullOutline();
        } else {
          log(`FullOutlineStore: giving up retry — stores still on different documents after ${this.convergenceRetryCount} attempts (region=${regionDocId}, symbol=${symbolDocId}); next store event will trigger refresh`);
        }
        return;
      }
    }
    this.convergenceRetryCount = 0;

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
      const oldTopLevelItems = this._topLevelItems;
      this._topLevelItems = topLevelItems;
      this._allParentIds = allParentIds;
      // Mirror RegionStore's change-detection: skip the event when the
      // recomputed outline is structurally identical. Without this, every
      // debounced edit-tick fires a tree refresh even when nothing the
      // user cares about changed (e.g. a no-op reparse after a transient
      // versionedDocumentId mismatch). VS Code re-runs getChildren +
      // getTreeItem on every node when the event fires.
      if (didTopLevelItemsChange(oldTopLevelItems, topLevelItems)) {
        this._onDidChangeFullOutlineItems.fire();
      }
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
      DEBOUNCE_CURSOR_TRACKING_MS
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

/**
 * Recursive structural equality on the tree: id, displayName, range, and
 * children. We need to walk into children because nested edits (e.g. a
 * symbol added inside a class) are invisible from the top level alone.
 * Items are rebuilt from scratch on every refresh, so reference equality
 * never holds — this comparison is on content only.
 *
 * Level-2 granular firing (only invalidating the changed subtree) would
 * require reusing item references when content matches; deferred — see
 * v1.0.5 perf-improvements notes.
 */
function didTopLevelItemsChange(
  oldItems: FullTreeItem[],
  newItems: FullTreeItem[]
): boolean {
  if (oldItems.length !== newItems.length) {
    return true;
  }
  for (let i = 0; i < oldItems.length; i++) {
    const oldItem = oldItems[i];
    const newItem = newItems[i];
    if (oldItem === undefined || newItem === undefined) {
      return true;
    }
    if (!areFullTreeItemsEqual(oldItem, newItem)) {
      return true;
    }
  }
  return false;
}

function areFullTreeItemsEqual(a: FullTreeItem, b: FullTreeItem): boolean {
  if (
    a.id !== b.id ||
    a.displayName !== b.displayName ||
    a.itemType !== b.itemType ||
    !a.range.isEqual(b.range)
  ) {
    return false;
  }
  return !didTopLevelItemsChange(a.children, b.children);
}

// #endregion
