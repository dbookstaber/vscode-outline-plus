import * as assert from "assert";
import * as vscode from "vscode";
import { type CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { type FullOutlineStore } from "../../state/FullOutlineStore";
import { getDocumentId } from "../../lib/getVersionedDocumentId";
import { FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { FullTreeViewProvider } from "../../treeView/fullTreeView/FullTreeViewProvider";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Regression test for plan 2.1 ("suspect D"): auto-highlight silently dies
 * after an outline-neutral edit.
 *
 * An intra-line edit that changes no region/symbol structure still bumps the
 * document's version. The stores advance their versioned id only when they
 * fire a change event, so after an outline-neutral edit the store's
 * `versionedDocumentId` lags the active editor. The provider's reveal gate used
 * to compare the store's *versioned* id against the active editor's versioned
 * id, so it rejected every reveal until the next structural edit — the highlight
 * stopped tracking the cursor.
 *
 * The fix weakens the gate to a `documentId` (URI) comparison, which still
 * blocks cross-document reveals but no longer requires version-exactness. This
 * test drives the provider with a store whose `versionedDocumentId` is stale
 * (behind the active editor) but whose `documentId` matches, and asserts a
 * `treeView.reveal` is attempted. It FAILS on the pre-fix versioned gate.
 */
suite("Auto-highlight reveal gate (plan 2.1 / suspect D)", function () {
  this.timeout(10000);

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("reveal is attempted when the store's version is stale but its documentId is current", async () => {
    const doc = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(doc);
    await waitForCondition(
      () => vscode.window.activeTextEditor?.document === doc,
      3000,
      25
    );

    const documentId = getDocumentId(doc);
    const currentVersion = doc.version;
    // Simulate the post-neutral-edit state: the document version has advanced
    // but the store never refreshed, so its versioned id lags the editor by a
    // version. The URI (documentId) is unchanged.
    const staleVersionedId = `${documentId}@${currentVersion - 1}`;
    assert.notStrictEqual(
      staleVersionedId,
      `${documentId}@${currentVersion}`,
      "Test setup: stale versioned id must differ from the active editor's"
    );

    const activeItem = new FullTreeItem({
      id: "test-active-item-0",
      displayName: "TestActiveItem",
      range: new vscode.Range(0, 0, 0, 5),
      itemType: "symbol",
      parent: undefined,
      children: [],
      icon: undefined,
    });

    const onDidChangeItems = new vscode.EventEmitter<void>();
    const onDidChangeActiveItem = new vscode.EventEmitter<void>();
    const fakeStore = {
      activeFullOutlineItem: activeItem,
      topLevelFullOutlineItems: [activeItem],
      documentId,
      versionedDocumentId: staleVersionedId,
      allParentIds: new Set<string>(),
      onDidChangeFullOutlineItems: onDidChangeItems.event,
      onDidChangeActiveFullOutlineItem: onDidChangeActiveItem.event,
    } as unknown as FullOutlineStore;

    const fakeCollapsibleStateManager = {
      getSavedCollapsibleState: () => undefined,
      onCollapseTreeItem: () => undefined,
      onExpandTreeItem: () => undefined,
      onExpandAllTreeItems: () => undefined,
    } as unknown as CollapsibleStateManager;

    const subscriptions: vscode.Disposable[] = [];
    const provider = new FullTreeViewProvider(fakeStore, fakeCollapsibleStateManager, subscriptions);

    let revealCount = 0;
    const visibilityEmitter = new vscode.EventEmitter<vscode.TreeViewVisibilityChangeEvent>();
    const collapseEmitter = new vscode.EventEmitter<vscode.TreeViewExpansionEvent<FullTreeItem>>();
    const expandEmitter = new vscode.EventEmitter<vscode.TreeViewExpansionEvent<FullTreeItem>>();
    const fakeTreeView = {
      reveal: (): Thenable<void> => {
        revealCount++;
        return Promise.resolve();
      },
      onDidCollapseElement: collapseEmitter.event,
      onDidExpandElement: expandEmitter.event,
      onDidChangeVisibility: visibilityEmitter.event,
    } as unknown as vscode.TreeView<FullTreeItem>;

    provider.setTreeView(fakeTreeView, subscriptions);

    try {
      // Make the view visible → schedules an auto-highlight (debounced).
      visibilityEmitter.fire({ visible: true });

      await waitForCondition(() => revealCount > 0, 2000, 25).catch(() => undefined);

      assert.ok(
        revealCount > 0,
        "treeView.reveal should be attempted after an outline-neutral edit left the store's version stale"
      );
    } finally {
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
      onDidChangeItems.dispose();
      onDidChangeActiveItem.dispose();
      visibilityEmitter.dispose();
      collapseEmitter.dispose();
      expandEmitter.dispose();
    }
  });
});
