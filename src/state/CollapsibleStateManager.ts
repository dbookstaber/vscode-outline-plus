import * as vscode from "vscode";
import { getDocumentIdFromUri, rescopeTreeItemId } from "../lib/getVersionedDocumentId";
import { type DebouncedFunction, debounce } from "../utils/debounce";
import { log, logError } from "../utils/debugLog";
import { throwNever } from "../utils/errorUtils";

const CLEAN_IDS_AND_MAYBE_SWITCH_MODE_DEBOUNCE_DELAY_MS = 2000;
const SAVE_TO_WORKSPACE_STATE_DEBOUNCE_DELAY_MS = 15000;

/**
 * Upper bound on how many documents' collapse state we retain in memory (and
 * therefore persist to workspaceState). VS Code only ever fires
 * `onDidRenameFiles`/`onDidDeleteFiles` for edits made *inside* the editor, so
 * files renamed/deleted externally (git checkout, terminal `rm`, etc.) would
 * otherwise leave orphaned entries that accumulate forever. When we exceed the
 * cap we evict the least-recently-touched document. The value is generous
 * relative to any realistic working set so eviction is a safety net, not a
 * routine event.
 */
const MAX_TRACKED_DOCUMENTS = 200;

/** Whether we should store a set of IDs for collapsed or expanded items; we can switch modes to
 * reduce how much data we need to store. E.g. after calling "Expand All" we should switch to
 * `collapsedItemIds` mode; after collapsing all items we should switch to `expandedItemIds`. */
type StorageMode = "collapsedItemIds" | "expandedItemIds";

/**
 * Items are expanded by default, so the default storage mode is `collapsedItemIds` to reduce the
 * number of IDs we need to store.
 */
const DEFAULT_STORAGE_MODE: StorageMode = "collapsedItemIds";

type CollapsibleStateStore = {
  /** Whether we should store collapsed or expanded item IDs */
  storageMode: StorageMode;
  /** A set of either collapsed or expanded item IDs, depending on `storageMode` */
  itemIds: Set<string>;
};

type SerializedCollapsibleStateStore = {
  storageMode: StorageMode;
  itemIds: string[];
};
type SerializedCollapsibleStateStoreByDocumentId = Record<string, SerializedCollapsibleStateStore>;

type CleanDebouncer = DebouncedFunction<
  (store: CollapsibleStateStore, allParentIds: Set<string>) => void
>;

/**
 * Manages the collapsible state (Expanded/Collapsed) of tree items across files, so that
 * collapsible state persists across sessions and file switches.
 */
export class CollapsibleStateManager implements vscode.Disposable {
  /**
   * Stores keyed by document ID. A `Map` (not a plain object) so we can rely on
   * insertion order for least-recently-used eviction: the first key is the LRU
   * entry, and touching a document re-inserts it at the end.
   */
  private storeByDocumentId = new Map<string, CollapsibleStateStore>();

  /**
   * Per-document debouncers for {@link cleanIdsAndMaybeSwitchMode}. Previously a
   * single shared debouncer meant a collapse/expand in document B would cancel
   * document A's still-pending cleanup (its mode switch / stale-id pruning was
   * silently dropped). Keying by document ID isolates them.
   */
  private cleanDebouncerByDocumentId = new Map<string, CleanDebouncer>();

  private debouncedSaveToWorkspaceState = debounce(async () => {
    await this.saveToWorkspaceState();
  }, SAVE_TO_WORKSPACE_STATE_DEBOUNCE_DELAY_MS);

  private readonly renameDisposable: vscode.Disposable;
  private readonly deleteDisposable: vscode.Disposable;

  constructor(
    private workspaceState: vscode.Memento,
    private storageKey: string,
    subscriptions?: vscode.Disposable[]
  ) {
    this.loadFromWorkspaceState();
    this.renameDisposable = vscode.workspace.onDidRenameFiles((event) => {
      const { files } = event;
      for (const fileRenaming of files) this.onFileRename(fileRenaming);
    });
    this.deleteDisposable = vscode.workspace.onDidDeleteFiles((event) => {
      const { files } = event;
      for (const deletedUri of files) this.onFileDelete(deletedUri);
    });
    // Add disposables to subscriptions if provided, to ensure proper cleanup
    if (subscriptions) {
      subscriptions.push(this.renameDisposable, this.deleteDisposable, this);
    }
  }

  dispose(): void {
    this.cancelAllCleanDebouncers();
    // Cancel the pending save; the awaitable `flush()` below is the supported
    // shutdown path. `dispose()` is sync per the `vscode.Disposable` contract,
    // so any save initiated here would race extension-host teardown.
    this.debouncedSaveToWorkspaceState.cancel();
    this.renameDisposable.dispose();
    this.deleteDisposable.dispose();
    this.saveToWorkspaceState().catch((error: unknown) => {
      logError("CollapsibleStateManager: failed to save on dispose", error);
    });
  }

  /**
   * Awaitable flush of any pending workspace-state writes. Call from the
   * extension's async `deactivate()` so VSCode delays teardown until the
   * collapse/expand state is persisted.
   */
  async flush(): Promise<void> {
    this.cancelAllCleanDebouncers();
    this.debouncedSaveToWorkspaceState.cancel();
    await this.saveToWorkspaceState();
  }

  // #region File rename/delete migration

  /**
   * Migrates persisted state when a file OR folder is renamed/moved. VS Code
   * fires a single event with the folder's URI for folder renames, so we must
   * prefix-match every descendant document ID rather than doing an exact-URI
   * lookup (the old behavior silently lost all children's state).
   *
   * Matching is on path-segment boundaries so `/a/b` migrates `/a/b/c.ts` but
   * never `/a/bc.ts`.
   *
   * The Full Outline view persists SCOPED item ids (`<documentId>\0<baseId>`),
   * so migrating a store's key is not enough — every stored id whose scope is
   * the old documentId is rescoped to the new one, or the regenerated (new-id)
   * tree would miss every lookup and `removeInvalidItemIds` would purge the
   * migrated state. The Regions view's unscoped ids pass through untouched.
   */
  onFileRename({ oldUri, newUri }: { oldUri: vscode.Uri; newUri: vscode.Uri }): void {
    const oldPrefix = stripTrailingSlash(getDocumentIdFromUri(oldUri));
    const newPrefix = stripTrailingSlash(getDocumentIdFromUri(newUri));
    let didChange = false;
    for (const docId of Array.from(this.storeByDocumentId.keys())) {
      const migratedDocId = migrateDocId(docId, oldPrefix, newPrefix);
      if (migratedDocId === undefined) continue;
      const store = this.storeByDocumentId.get(docId);
      this.deleteDocumentStore(docId);
      if (store) {
        rescopeStoreItemIds(store, docId, migratedDocId);
        this.storeByDocumentId.set(migratedDocId, store);
      }
      didChange = true;
    }
    if (didChange) this.debouncedSaveToWorkspaceState();
  }

  /**
   * Prunes persisted state when a file OR folder is deleted. As with rename,
   * folder deletes arrive as a single folder-level URI, so we prefix-match all
   * descendants (segment-boundary aware) to avoid orphaned entries persisting
   * forever.
   */
  onFileDelete(deletedUri: vscode.Uri): void {
    const prefix = stripTrailingSlash(getDocumentIdFromUri(deletedUri));
    let didChange = false;
    for (const docId of Array.from(this.storeByDocumentId.keys())) {
      if (docId === prefix || docId.startsWith(prefix + "/")) {
        this.deleteDocumentStore(docId);
        didChange = true;
      }
    }
    if (didChange) this.debouncedSaveToWorkspaceState();
  }

  // #endregion

  /** Gets the saved collapsible state of the given item ID in the given document, if available.
   * Assumes the item has children and thus is collapsible or expandable; if it's not, then
   * {@link vscode.TreeItemCollapsibleState.None TreeItemCollapsibleState.None} should be used
   * either way.
   */
  getSavedCollapsibleState({
    documentId,
    itemId,
  }: {
    documentId: string | undefined;
    itemId: string;
  }): vscode.TreeItemCollapsibleState | undefined {
    if (documentId === undefined) {
      log("No document ID provided for collapsible state lookup");
      return undefined;
    }
    const collapsibleStateStore = this.storeByDocumentId.get(documentId);
    if (!collapsibleStateStore) return undefined;
    const { storageMode, itemIds } = collapsibleStateStore;
    switch (storageMode) {
      case "collapsedItemIds":
        return itemIds.has(itemId)
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.Expanded; // defaults to Expanded, but a childless item should be None
      case "expandedItemIds":
        return itemIds.has(itemId)
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed; // defaults to Collapsed, but a childless item should be None
      default:
        throwNever(storageMode);
    }
  }

  // #region On collapse/expand

  onCollapseTreeItem({
    itemId,
    documentId,
    allParentIds,
  }: {
    itemId: string;
    documentId: string | undefined;
    allParentIds: Set<string>;
  }): void {
    if (documentId === undefined) {
      log("No document ID provided for collapse event");
      return;
    }
    const store = this.getOrCreateStoreForDocument(documentId);
    switch (store.storageMode) {
      case "collapsedItemIds":
        store.itemIds.add(itemId);
        this.getCleanDebouncerForDocument(documentId)(store, allParentIds);
        break;
      case "expandedItemIds":
        store.itemIds.delete(itemId);
        break;
      default:
        throwNever(store.storageMode);
    }
    this.debouncedSaveToWorkspaceState();
  }

  onExpandTreeItem({
    itemId,
    documentId,
    allParentIds,
  }: {
    itemId: string;
    documentId: string | undefined;
    allParentIds: Set<string>;
  }): void {
    if (documentId === undefined) {
      log("No document ID provided for expand event");
      return;
    }
    const store = this.getOrCreateStoreForDocument(documentId);
    switch (store.storageMode) {
      case "collapsedItemIds":
        store.itemIds.delete(itemId);
        break;
      case "expandedItemIds":
        store.itemIds.add(itemId);
        this.getCleanDebouncerForDocument(documentId)(store, allParentIds);
        break;
      default:
        throwNever(store.storageMode);
    }
    this.debouncedSaveToWorkspaceState();
  }

  onExpandAllTreeItems({ documentId }: { documentId: string | undefined }): void {
    if (documentId === undefined) {
      return;
    }
    const store = this.getOrCreateStoreForDocument(documentId);
    // Regardless of the current storage mode, now that all items are going to be expanded (i.e.
    // none collapsed), we should switch to collapsedItemIds mode and clear the item IDs set
    store.storageMode = "collapsedItemIds";
    store.itemIds.clear();
    this.debouncedSaveToWorkspaceState();
  }

  // #endregion

  // #region Document store management

  private getOrCreateStoreForDocument(documentId: string): CollapsibleStateStore {
    const existing = this.storeByDocumentId.get(documentId);
    if (existing) {
      // Bump recency: re-insert so this document is treated as most-recently-used.
      this.storeByDocumentId.delete(documentId);
      this.storeByDocumentId.set(documentId, existing);
      return existing;
    }
    const newStore: CollapsibleStateStore = {
      storageMode: DEFAULT_STORAGE_MODE,
      itemIds: new Set(),
    };
    this.storeByDocumentId.set(documentId, newStore);
    this.evictLeastRecentlyUsedIfOverCap(documentId);
    return newStore;
  }

  /**
   * Evicts least-recently-used document stores while over {@link MAX_TRACKED_DOCUMENTS}.
   * Never evicts `keepDocumentId` (the store we just created/touched).
   */
  private evictLeastRecentlyUsedIfOverCap(keepDocumentId: string): void {
    while (this.storeByDocumentId.size > MAX_TRACKED_DOCUMENTS) {
      const lruDocId = this.getLeastRecentlyUsedDocId(keepDocumentId);
      if (lruDocId === undefined) break;
      this.deleteDocumentStore(lruDocId);
    }
  }

  private getLeastRecentlyUsedDocId(excludeDocumentId: string): string | undefined {
    for (const docId of this.storeByDocumentId.keys()) {
      if (docId !== excludeDocumentId) return docId;
    }
    return undefined;
  }

  private getCleanDebouncerForDocument(documentId: string): CleanDebouncer {
    let debouncer = this.cleanDebouncerByDocumentId.get(documentId);
    if (!debouncer) {
      debouncer = debounce(
        this.cleanIdsAndMaybeSwitchMode.bind(this),
        CLEAN_IDS_AND_MAYBE_SWITCH_MODE_DEBOUNCE_DELAY_MS
      );
      this.cleanDebouncerByDocumentId.set(documentId, debouncer);
    }
    return debouncer;
  }

  private cancelAllCleanDebouncers(): void {
    for (const debouncer of this.cleanDebouncerByDocumentId.values()) {
      debouncer.cancel();
    }
  }

  /** Cleans up the IDs in the store, removing any that are no longer valid (e.g. they may have been
   * added earlier but since renamed and no longer valid in the document). Switches storage mode if
   * the store is full after cleaning (i.e. all parent items are stored in itemIds).
   */
  private cleanIdsAndMaybeSwitchMode(
    store: CollapsibleStateStore,
    allParentIds: Set<string>
  ): void {
    this.removeInvalidItemIds(store, allParentIds);
    this.maybeSwitchStorageMode(store, allParentIds);
  }

  /** Removes item IDs from the store that are not in the set of all parent IDs. This is particularly
   * important before potentially switching storage modes depending on if all parent IDs are stored
   * in item IDs (representing all collapsible items being expanded/collapsed), since outdated IDs
   * would lead that check to be incorrect.
   */
  private removeInvalidItemIds(store: CollapsibleStateStore, allParentIds: Set<string>): void {
    for (const itemId of store.itemIds) {
      if (!allParentIds.has(itemId)) {
        store.itemIds.delete(itemId);
      }
    }
  }

  /** Switches the storage mode if all parent IDs are stored in item IDs. */
  private maybeSwitchStorageMode(store: CollapsibleStateStore, allParentIds: Set<string>): void {
    const { itemIds, storageMode } = store;
    if (itemIds.size >= allParentIds.size) {
      itemIds.clear();
      store.storageMode = this.getOppositeStorageMode(storageMode);
    }
  }

  /** Returns the opposite storage mode of the given storage mode. */
  private getOppositeStorageMode(storageMode: StorageMode): StorageMode {
    switch (storageMode) {
      case "collapsedItemIds":
        return "expandedItemIds";
      case "expandedItemIds":
        return "collapsedItemIds";
      default:
        throwNever(storageMode);
    }
  }

  private deleteDocumentStore(documentId: string): void {
    this.storeByDocumentId.delete(documentId);
    const debouncer = this.cleanDebouncerByDocumentId.get(documentId);
    if (debouncer) {
      debouncer.cancel();
      this.cleanDebouncerByDocumentId.delete(documentId);
    }
  }

  // #endregion

  // #region Workspace storage

  /** Loads persisted collapse state from storage into memory */
  private loadFromWorkspaceState(): void {
    const serializedStoreByDocId =
      this.workspaceState.get<SerializedCollapsibleStateStoreByDocumentId>(this.storageKey);
    if (!serializedStoreByDocId) {
      return;
    }

    for (const [docId, serializedStore] of Object.entries(serializedStoreByDocId)) {
      this.storeByDocumentId.set(docId, {
        storageMode: serializedStore.storageMode,
        itemIds: new Set(serializedStore.itemIds),
      });
    }
    // Guard against a persisted payload larger than the cap (e.g. from an
    // older build without the cap). Keep the most-recently-inserted entries.
    while (this.storeByDocumentId.size > MAX_TRACKED_DOCUMENTS) {
      const lruDocId = this.storeByDocumentId.keys().next().value;
      if (lruDocId === undefined) break;
      this.deleteDocumentStore(lruDocId);
    }
  }

  /** Saves the current state to VS Code's workspace storage (if storage is provided) */
  async saveToWorkspaceState(): Promise<void> {
    try {
      const serializedStoreByDocId: SerializedCollapsibleStateStoreByDocumentId = {};
      for (const [docId, store] of this.storeByDocumentId) {
        const { storageMode, itemIds } = store;
        if (this.isDefaultStore(store)) {
          // No need to save a default store
          continue;
        }
        serializedStoreByDocId[docId] = { storageMode, itemIds: Array.from(itemIds) };
      }
      if (Object.keys(serializedStoreByDocId).length === 0) {
        await this.workspaceState.update(this.storageKey, undefined);
        return;
      }
      await this.workspaceState.update(this.storageKey, serializedStoreByDocId);
    } catch (error) {
      logError("CollapsibleStateManager: failed to save workspace state", error);
    }
  }

  // #endregion

  private isDefaultStore(store: CollapsibleStateStore): boolean {
    const { storageMode, itemIds } = store;
    return storageMode === DEFAULT_STORAGE_MODE && itemIds.size === 0;
  }
}

/**
 * Removes a single trailing slash from a document-ID string so that
 * prefix-with-`/` matching behaves consistently whether or not VS Code includes
 * a trailing separator on folder URIs.
 */
function stripTrailingSlash(docId: string): string {
  return docId.endsWith("/") ? docId.slice(0, -1) : docId;
}

/**
 * Rewrites a store's persisted item ids in place when its owning document is
 * migrated from `oldDocumentId` to `newDocumentId`. Scoped ids (Full Outline)
 * are rescoped; unscoped ids (Regions) are left verbatim by
 * {@link rescopeTreeItemId}. Mutates the single {@link CollapsibleStateStore.itemIds}
 * set, which is authoritative for whichever `storageMode` the store is in.
 */
function rescopeStoreItemIds(
  store: CollapsibleStateStore,
  oldDocumentId: string,
  newDocumentId: string
): void {
  const rescoped = new Set<string>();
  for (const itemId of store.itemIds) {
    rescoped.add(rescopeTreeItemId(oldDocumentId, newDocumentId, itemId));
  }
  store.itemIds = rescoped;
}

/**
 * Returns the migrated document ID if `docId` is `oldPrefix` itself (a file
 * rename) or a path-segment descendant of it (a folder rename); otherwise
 * `undefined`. Segment-boundary aware: `/a/b` matches `/a/b/c.ts` but not
 * `/a/bc.ts`.
 */
function migrateDocId(
  docId: string,
  oldPrefix: string,
  newPrefix: string
): string | undefined {
  if (docId === oldPrefix) return newPrefix;
  if (docId.startsWith(oldPrefix + "/")) {
    return newPrefix + docId.slice(oldPrefix.length);
  }
  return undefined;
}
