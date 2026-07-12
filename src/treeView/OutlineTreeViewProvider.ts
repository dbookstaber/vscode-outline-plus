import * as vscode from "vscode";
import { DEBOUNCE_CURSOR_TRACKING_MS, DEBOUNCE_TREE_REFRESH_MS } from "../constants";
import { isCurrentActiveDocumentId } from "../lib/getVersionedDocumentId";
import { type CollapsibleStateManager } from "../state/CollapsibleStateManager";
import { type DebouncedFunction, debounce } from "../utils/debounce";
import { log } from "../utils/debugLog";
import { collectExpandAnchors } from "./collectExpandAnchors";

/**
 * Structural shape shared by both tree-node types (`FullTreeItem`, `Region`):
 * a stable id, children, and an optional parent. The base provider walks these
 * to serve `getChildren`/`getParent` and to expand subtrees.
 */
type OutlineTreeNode<T> = {
  id: string;
  children: T[];
  parent?: T | undefined;
};

/**
 * Bridges a concrete store (FullOutlineStore / RegionStore) into the vocabulary
 * the base provider speaks, so the two ~90%-identical providers can share one
 * implementation. Subclasses build one of these from their store and pass it to
 * `super()`; it is built from the constructor parameter (not `this`), so it is
 * safe to construct before the base finishes initializing.
 */
export type OutlineStoreAdapter<T> = {
  readonly activeItem: T | undefined;
  readonly topLevelItems: T[];
  readonly documentId: string | undefined;
  readonly allParentIds: Set<string>;
  readonly onDidChangeItems: vscode.Event<void>;
  readonly onDidChangeActiveItem: vscode.Event<void>;
  /** Reads the view's "auto-highlight active item" setting. */
  shouldAutoHighlight(): boolean;
  /** Builds the concrete `vscode.TreeItem` for an element. */
  createTreeItem(element: T, collapsibleState: vscode.TreeItemCollapsibleState): vscode.TreeItem;
};

/**
 * Shared base for the Full Outline and Regions tree views. Owns tree-data
 * refresh, active-item auto-highlight, expand-all, and collapsible-state
 * resolution; the store-specific differences live in the {@link OutlineStoreAdapter}.
 */
export abstract class OutlineTreeViewProvider<T extends OutlineTreeNode<T>>
  implements vscode.TreeDataProvider<T>, vscode.Disposable
{
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  protected treeView: vscode.TreeView<T> | undefined;

  private readonly debouncedRefreshTree: DebouncedFunction<() => void> = debounce(
    this.refreshTree.bind(this),
    DEBOUNCE_TREE_REFRESH_MS
  );

  private readonly debouncedAutoHighlight: DebouncedFunction<() => void> = debounce(
    this.autoHighlightActiveItem.bind(this),
    DEBOUNCE_CURSOR_TRACKING_MS
  );

  protected isTreeViewVisible = false;

  constructor(
    protected readonly adapter: OutlineStoreAdapter<T>,
    protected readonly collapsibleStateManager: CollapsibleStateManager,
    subscriptions: vscode.Disposable[]
  ) {
    // Register for disposal (plan 2.9: providers own timers + an emitter but
    // previously had no dispose()). `subscriptions` is context.subscriptions.
    subscriptions.push(this);
    this.registerListeners(subscriptions);
    this.debouncedAutoHighlight();
  }

  dispose(): void {
    this.debouncedRefreshTree.cancel();
    this.debouncedAutoHighlight.cancel();
    this._onDidChangeTreeData.dispose();
  }

  private registerListeners(subscriptions: vscode.Disposable[]): void {
    vscode.window.onDidChangeActiveTextEditor(
      () => this.debouncedAutoHighlight.cancel(),
      this,
      subscriptions
    );
    vscode.workspace.onDidChangeTextDocument(this.onDocumentChange.bind(this), this, subscriptions);
    this.adapter.onDidChangeItems(this.debouncedRefreshTree, this, subscriptions);
    this.adapter.onDidChangeActiveItem(this.onActiveItemChange.bind(this), this, subscriptions);
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (event.document === vscode.window.activeTextEditor?.document) {
      // Suspect C fix: previously this only *cancelled* the pending highlight,
      // on the assumption the region/symbol stores would fire and re-trigger it.
      // For edits that change neither structure nor selection (format-on-type,
      // programmatic edits by another extension, a multi-cursor edit elsewhere),
      // no store fires and no selection event arrives, so the cancelled highlight
      // was simply lost. Re-arm a fallback highlight instead: `debouncedAutoHighlight`
      // cancels the stale pending reveal and schedules a fresh one, so the
      // highlight re-asserts even when nothing downstream fires.
      this.debouncedAutoHighlight();
    }
  }

  private refreshTree(): void {
    this._onDidChangeTreeData.fire(undefined);
    // Suspect A/B fix: firing onDidChangeTreeData makes VS Code rebuild the tree
    // and drop its selected/highlighted row. Re-assert the highlight *after* the
    // rebuild is flushed so a tree refresh that lands after a reveal cannot leave
    // the active item un-highlighted (suspect A), and so a rebuild that dropped
    // the selection is restored even when the active-item reference is unchanged
    // (suspect B — the store fires no active-item event in that case).
    this.debouncedAutoHighlight();
  }

  // #region Highlighting active item
  private onActiveItemChange(): void {
    this.debouncedAutoHighlight();
  }

  /**
   * Auto-highlights (using `treeView.reveal`) the active item in the tree view if:
   * 1. The tree view is visible
   * 2. The view's auto-highlight setting is enabled
   * 3. The active item belongs to the active editor's document (by URI)
   */
  private autoHighlightActiveItem(): void {
    this.debouncedAutoHighlight.cancel();
    if (!this.isTreeViewVisible) {
      // Revealing the active item when the view isn't already visible would expand it if collapsed
      // and/or change panel if not already open (e.g. if in Search view), which would be annoying
      return;
    }
    if (!this.adapter.shouldAutoHighlight()) {
      return;
    }
    // Suspect D fix (plan 2.1): gate on documentId (URI), NOT versionedDocumentId.
    // An outline-neutral edit bumps the document version without producing any
    // store event, so the store's versionedDocumentId lags the active editor and
    // a version-exact gate would reject every reveal until the next structural
    // edit — the highlight silently stops tracking the cursor. Comparing the URI
    // still blocks cross-document reveals (the gate's real purpose) while allowing
    // same-document reveals after neutral edits, when the outline is structurally
    // still valid.
    if (!isCurrentActiveDocumentId(this.adapter.documentId)) {
      return;
    }
    this.highlightActiveItem();
  }

  private highlightActiveItem({ expand = false }: { expand?: boolean | number } = {}): void {
    this.debouncedAutoHighlight.cancel();
    const activeItem = this.adapter.activeItem;
    if (!this.treeView || !activeItem) {
      return;
    }
    this.safeReveal(activeItem, { select: true, focus: false, expand });
  }

  /**
   * Wraps `treeView.reveal` and swallows rejections (plan 2.9). `reveal` returns
   * a Thenable that rejects if, e.g., the item is no longer in the tree by the
   * time VS Code processes it (a rebuild replaced it); an unhandled rejection
   * would surface as noise. Returns the (settled) promise so `expandAll` can await.
   */
  private safeReveal(
    item: T,
    options: { select?: boolean; focus?: boolean; expand?: boolean | number }
  ): Thenable<void> {
    if (!this.treeView) {
      return Promise.resolve();
    }
    return this.treeView.reveal(item, options).then(undefined, (error: unknown) => {
      log(`OutlineTreeViewProvider: treeView.reveal rejected: ${String(error)}`);
    });
  }
  // #endregion

  // #region Required TreeDataProvider methods
  getTreeItem(element: T): vscode.TreeItem {
    const collapsibleState = this.resolveCollapsibleState(element.id, element.children.length > 0);
    return this.adapter.createTreeItem(element, collapsibleState);
  }

  private resolveCollapsibleState(
    itemId: string,
    hasChildren: boolean
  ): vscode.TreeItemCollapsibleState {
    if (!hasChildren) {
      return vscode.TreeItemCollapsibleState.None;
    }
    const savedCollapsibleState = this.collapsibleStateManager.getSavedCollapsibleState({
      documentId: this.adapter.documentId,
      itemId,
    });
    return savedCollapsibleState ?? vscode.TreeItemCollapsibleState.Expanded;
  }

  getParent(element: T): vscode.ProviderResult<T> {
    return element.parent;
  }

  getChildren(element?: T): T[] {
    return element ? element.children : this.adapter.topLevelItems;
  }
  // #endregion

  /**
   * Sets the tree view for this provider and registers event listeners for expand/collapse events.
   * To be called after the tree view is created (which requires the provider to be created first,
   * hence why this can't go in the constructor).
   */
  setTreeView(treeView: vscode.TreeView<T>, subscriptions: vscode.Disposable[]): void {
    this.treeView = treeView;
    subscriptions.push(
      treeView.onDidCollapseElement(this.onDidCollapseElement.bind(this)),
      treeView.onDidExpandElement(this.onDidExpandElement.bind(this)),
      treeView.onDidChangeVisibility(this.onTreeViewVisibilityChanged.bind(this))
    );
  }

  // #region On item collapse/expand
  private onDidCollapseElement(event: vscode.TreeViewExpansionEvent<T>): void {
    const { id: itemId } = event.element;
    this.collapsibleStateManager.onCollapseTreeItem({
      itemId,
      documentId: this.adapter.documentId,
      allParentIds: this.adapter.allParentIds,
    });
  }

  private onDidExpandElement(event: vscode.TreeViewExpansionEvent<T>): void {
    const { id: itemId } = event.element;
    this.collapsibleStateManager.onExpandTreeItem({
      itemId,
      documentId: this.adapter.documentId,
      allParentIds: this.adapter.allParentIds,
    });
  }

  async expandAllTreeItems(): Promise<void> {
    if (!this.treeView) {
      return;
    }
    this.collapsibleStateManager.onExpandAllTreeItems({ documentId: this.adapter.documentId });
    // `reveal`'s `expand` caps at 3 levels, so reveal an anchor every 3 levels
    // to fully expand subtrees deeper than that (e.g. namespace > class > region
    // > member). Reveal shallow anchors first so deeper ones are already visible.
    const anchors = collectExpandAnchors(this.adapter.topLevelItems);
    for (const anchor of anchors) {
      await this.safeReveal(anchor, { select: false, focus: false, expand: 3 });
    }
    // Finish by highlighting the cursor's active item. We do this regardless of the
    // auto-highlight setting, since the view is open anyway when/after calling Expand All, so
    // there's no harm in revealing. This helps re-orient instead of scroll position being reset
    // to the top of the tree view.
    this.highlightActiveItem({ expand: 3 });
  }
  // #endregion

  // #region On tree view visibility change
  private onTreeViewVisibilityChanged(event: vscode.TreeViewVisibilityChangeEvent): void {
    if (event.visible) {
      this.isTreeViewVisible = true;
      this.debouncedAutoHighlight();
    } else {
      this.isTreeViewVisible = false;
      this.debouncedAutoHighlight.cancel();
    }
  }
  // #endregion
}
