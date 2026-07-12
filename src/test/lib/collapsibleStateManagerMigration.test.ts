import * as assert from "assert";
import * as vscode from "vscode";
import { CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { scopeTreeItemIdToDocument } from "../../lib/getVersionedDocumentId";
import { delay } from "../utils/waitForEvent";

/**
 * Regression tests for Plan 2.8 (folder rename/delete prefix migration) and
 * Plan 2.9 (per-document debounce for the clean/mode-switch pass).
 *
 * VS Code fires a single FOLDER-level URI for folder renames/deletes. The old
 * handlers did exact-URI lookups, so every descendant document's persisted
 * collapse state was silently lost on rename and orphaned forever on delete.
 */
suite("CollapsibleStateManager rename/delete migration + per-document debounce", function () {
  this.timeout(10000);

  /** Minimal in-memory Memento (mirrors deactivateFlush.test.ts). */
  class TestMemento implements vscode.Memento {
    private readonly storage = new Map<string, unknown>();
    keys(): readonly string[] {
      return Array.from(this.storage.keys());
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(key: string, defaultValue?: unknown): any {
      return this.storage.has(key) ? this.storage.get(key) : defaultValue;
    }
    update(key: string, value: unknown): Thenable<void> {
      if (value === undefined) {
        this.storage.delete(key);
      } else {
        this.storage.set(key, value);
      }
      return Promise.resolve();
    }
    setKeysForSync(): void {
      // no-op
    }
  }

  type SerializedStore = { storageMode: string; itemIds: string[] };

  function collapse(
    manager: CollapsibleStateManager,
    documentId: string,
    itemId: string
  ): void {
    manager.onCollapseTreeItem({
      itemId,
      documentId,
      // A larger parent set than the collapsed ids so the mode never auto-switches.
      allParentIds: new Set([itemId, `${itemId}-sibling`]),
    });
  }

  const docId = (fsPath: string): string => vscode.Uri.file(fsPath).toString();

  test("folder rename migrates every descendant document's state", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "rename-key");

    const childA = docId("/proj/src/folder/a.ts");
    const childB = docId("/proj/src/folder/nested/b.ts");
    collapse(manager, childA, "item-A");
    collapse(manager, childB, "item-B");

    // Rename the FOLDER (not the individual files).
    manager.onFileRename({
      oldUri: vscode.Uri.file("/proj/src/folder"),
      newUri: vscode.Uri.file("/proj/src/renamed"),
    });

    await manager.flush();
    const written = memento.get("rename-key") as Record<string, SerializedStore>;

    const newChildA = docId("/proj/src/renamed/a.ts");
    const newChildB = docId("/proj/src/renamed/nested/b.ts");
    assert.ok(written[newChildA], "Child A's state should migrate to the renamed folder");
    assert.deepStrictEqual(written[newChildA].itemIds, ["item-A"]);
    assert.ok(written[newChildB], "Nested child B's state should migrate too");
    assert.deepStrictEqual(written[newChildB].itemIds, ["item-B"]);
    assert.strictEqual(written[childA], undefined, "Old child A entry must be gone");
    assert.strictEqual(written[childB], undefined, "Old child B entry must be gone");

    manager.dispose();
  });

  test("rename rescopes Full Outline SCOPED item ids while migrating verbatim the Regions' unscoped ids", () => {
    // D-5: the Full Outline view persists ids of the form `<documentId>\0<baseId>`.
    // Migrating only the store KEY leaves those ids scoped to the OLD documentId,
    // so after a rename the view regenerates ids under the new documentId and every
    // lookup misses — removeInvalidItemIds then purges the migrated state.
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "scoped-key");

    const oldDoc = docId("/proj/src/folder/a.ts");
    const baseId = "symbol-Foo-1";
    const scopedId = scopeTreeItemIdToDocument(oldDoc, baseId);
    const unscopedId = "region-Bar-1"; // Regions view stores unscoped Region model ids.

    // Collapse both in the same document store, with a large parent set so the
    // debounced clean pass would never auto-switch mode (and flush() cancels it).
    manager.onCollapseTreeItem({
      itemId: scopedId,
      documentId: oldDoc,
      allParentIds: new Set([scopedId, unscopedId, "extra-parent"]),
    });
    manager.onCollapseTreeItem({
      itemId: unscopedId,
      documentId: oldDoc,
      allParentIds: new Set([scopedId, unscopedId, "extra-parent"]),
    });

    manager.onFileRename({
      oldUri: vscode.Uri.file("/proj/src/folder"),
      newUri: vscode.Uri.file("/proj/src/renamed"),
    });

    const newDoc = docId("/proj/src/renamed/a.ts");
    const newScopedId = scopeTreeItemIdToDocument(newDoc, baseId);

    // A hit reads as Collapsed (collapsedItemIds mode); a miss reads as Expanded.
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: newDoc, itemId: newScopedId }),
      vscode.TreeItemCollapsibleState.Collapsed,
      "scoped id must be rescoped to the new documentId so the regenerated tree hits"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: newDoc, itemId: scopedId }),
      vscode.TreeItemCollapsibleState.Expanded,
      "the OLD-scoped id must no longer be present after migration"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: newDoc, itemId: unscopedId }),
      vscode.TreeItemCollapsibleState.Collapsed,
      "an unscoped (Regions) id must migrate verbatim — its behavior is unchanged"
    );

    manager.dispose();
  });

  test("folder delete prunes every descendant document's state", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "delete-key");

    const childA = docId("/proj/src/folder/a.ts");
    const sibling = docId("/proj/src/other/c.ts");
    collapse(manager, childA, "item-A");
    collapse(manager, sibling, "item-C");

    manager.onFileDelete(vscode.Uri.file("/proj/src/folder"));

    await manager.flush();
    const written = memento.get("delete-key") as Record<string, SerializedStore>;

    assert.strictEqual(written[childA], undefined, "Deleted folder's child must be pruned");
    assert.ok(written[sibling], "Unrelated sibling must be retained");

    manager.dispose();
  });

  test("rename matches on path-segment boundaries (does not touch /a/bc for /a/b)", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "segment-key");

    // "/proj/src/b" is renamed. "/proj/src/bc.ts" shares a textual prefix but is
    // NOT inside the renamed folder — it must be left untouched.
    const insideFolder = docId("/proj/src/b/inside.ts");
    const lookalike = docId("/proj/src/bc.ts");
    collapse(manager, insideFolder, "item-inside");
    collapse(manager, lookalike, "item-lookalike");

    manager.onFileRename({
      oldUri: vscode.Uri.file("/proj/src/b"),
      newUri: vscode.Uri.file("/proj/src/renamed"),
    });

    await manager.flush();
    const written = memento.get("segment-key") as Record<string, SerializedStore>;

    assert.ok(
      written[docId("/proj/src/renamed/inside.ts")],
      "File inside the renamed folder should migrate"
    );
    assert.ok(
      written[lookalike],
      "Segment-boundary lookalike (/proj/src/bc.ts) must NOT be migrated away"
    );
    assert.strictEqual(
      written[docId("/proj/src/renamedc.ts")],
      undefined,
      "Lookalike must not be corrupted into a migrated id"
    );

    manager.dispose();
  });

  test("per-document debounce: cleanup in one document is not cancelled by another", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "debounce-key");

    const docOne = docId("/proj/one.ts");
    const docTwo = docId("/proj/two.ts");

    // In docOne, collapse the single parent so the store becomes "full"
    // (itemIds covers all parents) → the debounced clean pass should switch it
    // to expandedItemIds mode and clear the set.
    manager.onCollapseTreeItem({
      itemId: "only-parent",
      documentId: docOne,
      allParentIds: new Set(["only-parent"]),
    });
    // Immediately do the same in docTwo. Pre-fix, this shared the single debounce
    // timer and cancelled docOne's pending clean pass.
    manager.onCollapseTreeItem({
      itemId: "only-parent",
      documentId: docTwo,
      allParentIds: new Set(["only-parent"]),
    });

    // Wait past the 2000ms clean debounce so the pass fires.
    await delay(2500);
    await manager.flush();

    const written = memento.get("debounce-key") as Record<string, SerializedStore>;
    // Post-fix: docOne's clean pass ran → switched to expandedItemIds, empty set.
    // Pre-fix: docOne's clean was cancelled → stuck in collapsedItemIds with ["only-parent"].
    assert.ok(written[docOne], "docOne should have a persisted (non-default) store");
    assert.strictEqual(
      written[docOne].storageMode,
      "expandedItemIds",
      "docOne's clean/mode-switch pass must run despite docTwo's activity"
    );
    assert.deepStrictEqual(written[docOne].itemIds, []);

    manager.dispose();
  });
});
