import * as vscode from "vscode";
import { DEBOUNCE_CURSOR_TRACKING_MS, DEBOUNCE_FULL_OUTLINE_PAIRING_MS } from "../constants";
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

  // Plan 4.3: FullOutlineStore's inputs (region + symbol data) arrive already
  // debounced by DEBOUNCE_DOCUMENT_PARSE_MS upstream, so this is a short pairing
  // window (coalesce the two paired store events) rather than a second full
  // parse debounce — cutting ~200 ms of stacked latency off keystroke→tree.
  private debouncedRefreshFullOutline: DebouncedFunction<() => void> = debounce(
    this.refreshFullOutline.bind(this),
    DEBOUNCE_FULL_OUTLINE_PAIRING_MS
  );

  /**
   * Counts consecutive convergence-failed refresh attempts. Reset to 0 on a
   * successful (mismatch-free) refresh. Bounds the self-retry path in
   * {@link refreshFullOutline} so a permanently-stuck downstream store cannot
   * cause an infinite 250-ms retry loop.
   */
  private convergenceRetryCount = 0;
  private static readonly MAX_CONVERGENCE_RETRIES = 3;

  private debouncedRefreshActiveItem: DebouncedFunction<() => void> = debounce(
    this.refreshActiveItem.bind(this),
    DEBOUNCE_CURSOR_TRACKING_MS
  );

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
    this.debouncedRefreshActiveItem.cancel();
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
    // Parity with RegionStore's forced path, which bypasses change-detection so
    // its event always fires: a user-invoked Refresh must visibly rebuild the
    // tree even when the recomputed outline is structurally identical —
    // recovery from a stuck *view* is exactly what the button is for. The flag
    // is consumed by the next refreshItems() (it survives the convergence-guard
    // early return, so a deferred refresh still force-fires).
    this._forceFireOnNextRefresh = true;
    this.regionStore.forceRefresh();
    this.documentSymbolStore.forceRefresh();
  }

  private _forceFireOnNextRefresh = false;

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
      this.debouncedRefreshActiveItem.cancel();
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

    // Prefer the RegionStore's versioned id: it updates synchronously on every
    // edit, so it reflects the current document revision, whereas the
    // DocumentSymbolStore's id trails behind its async fetch. Fall back to the
    // symbol store's id only when the RegionStore has none yet (e.g. no active
    // document). NOTE: `??` does NOT select the "most current" of the two — it
    // simply prefers the region id unless it is undefined. That is correct here
    // only because the different-document guard above already returned, so both
    // stores agree on the document and differ at most in version, and the region
    // id is the fresher of the two.
    this._documentId = this.regionStore.documentId;
    this._versionedDocumentId = regionStoreVersionedDocumentId ?? documentSymbolStoreVersionedDocumentId;
    const forceFire = this._forceFireOnNextRefresh;
    this._forceFireOnNextRefresh = false;
    this.refreshItems(forceFire);
    this.refreshActiveItem();
  }

  /**
   * Recomputes the outline items from current region/symbol data and
   * unconditionally fires {@link onDidChangeFullOutlineItems}.
   *
   * Display-only settings (`modifierDisplay`, `useDistinctModifierColors`)
   * change item icons/labels/descriptions but NOT the id/name/type/range that
   * {@link didTopLevelItemsChange} compares — so the normal change-detection
   * short-circuit would suppress the refresh and the tree would keep the old
   * modifier presentation until an unrelated structural edit. This entry point
   * (wired to an `onDidChangeConfiguration` listener) forces the event so the
   * change is visible immediately.
   */
  rebuildItemsForDisplayConfigChange(): void {
    this.refreshItems(true);
  }

  private refreshItems(forceFire = false): void {
    const flattenedRegionItems = getFlattenedRegionFullTreeItems(
      this.regionStore.flattenedRegions,
      this._documentId
    );
    // Pass the active document for modifier extraction
    const activeDocument = vscode.window.activeTextEditor?.document;
    const flattenedSymbolItems = getFlattenedSymbolFullTreeItems(
      this.documentSymbolStore.flattenedDocumentSymbols,
      activeDocument,
      this._documentId
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
    if (forceFire || didTopLevelItemsChange(oldTopLevelItems, topLevelItems)) {
      this._onDidChangeFullOutlineItems.fire();
    }
  }
  // #endregion

  // #region Refresh active item on selection change
  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (event.textEditor === vscode.window.activeTextEditor) {
      this.debouncedRefreshActiveItem();
    }
  }

  private refreshActiveItem(): void {
    this.debouncedRefreshActiveItem.cancel();
    const cursorPosition = vscode.window.activeTextEditor?.selection.active;
    if (!cursorPosition) {
      return;
    }
    const oldActiveItem = this._activeItem;
    this._activeItem = getActiveFullTreeItem(this._topLevelItems, cursorPosition);
    // Structural comparison (not reference): items are rebuilt from scratch on
    // every refresh, so a reference compare fires onDidChangeActiveFullOutlineItem
    // after every rebuild even when the logical active item is unchanged — the
    // "inverse of suspect B" over-fire (one extra treeView.reveal per rebuild).
    // Compare by id + range so the event fires only on a genuine active-item
    // change; the provider re-asserts the highlight after each tree rebuild
    // independently, so suppressing the redundant fire here is safe.
    if (!isSameActiveItem(oldActiveItem, this._activeItem)) {
      this._onDidChangeActiveFullOutlineItem.fire();
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

/**
 * Structural identity for the *active* item: same logical item at the same
 * position. Used to decide whether to fire onDidChangeActiveFullOutlineItem.
 * Reference equality is unusable because the item objects are rebuilt on every
 * refresh; two objects representing the same item share an id and range.
 */
function isSameActiveItem(
  a: FullTreeItem | undefined,
  b: FullTreeItem | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.id === b.id && a.range.isEqual(b.range);
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
