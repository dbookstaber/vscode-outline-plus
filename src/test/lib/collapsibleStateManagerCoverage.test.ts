import * as assert from "assert";
import * as vscode from "vscode";
import { CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { assertExists } from "../../utils/assertUtils";
import { delay } from "../utils/waitForEvent";

/**
 * Plan 5.3 — CollapsibleStateManager behavior coverage BEYOND `flush()` and the
 * rename/delete + per-document-debounce coverage already in
 * `collapsibleStateManagerMigration.test.ts`.
 *
 * This file exercises the parts that no other suite touches:
 *   - `getSavedCollapsibleState` return values (Collapsed/Expanded) — never
 *     asserted anywhere else.
 *   - collapse -> expand round-trip within a single storage mode.
 *   - the collapsedItemIds <-> expandedItemIds storage-mode switch (both
 *     directions: the debounced collapse-all clean pass, and `onExpandAllTreeItems`).
 *   - loading persisted (serialized) state on construction.
 *
 * These are coverage tests for already-correct behavior (not regressions), so
 * they pass on current code; every assertion is on exact content.
 */
suite("CollapsibleStateManager coverage (state round-trips + serialized load)", function () {
  this.timeout(10000);

  /** Minimal in-memory Memento (mirrors deactivateFlush / migration tests). */
  class TestMemento implements vscode.Memento {
    constructor(private readonly storage = new Map<string, unknown>()) {}
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

  const Collapsed = vscode.TreeItemCollapsibleState.Collapsed;
  const Expanded = vscode.TreeItemCollapsibleState.Expanded;

  const docId = (fsPath: string): string => vscode.Uri.file(fsPath).toString();

  test("collapse -> expand round-trip restores the default (Expanded) state", () => {
    const manager = new CollapsibleStateManager(new TestMemento(), "roundtrip-key");
    const document = docId("/proj/roundtrip.ts");

    // Default mode is collapsedItemIds: an untouched parent reports Expanded.
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "foo" }),
      undefined,
      "No store yet -> undefined (caller falls back to default)"
    );

    // Collapse "foo" (allParentIds larger than the set so no auto mode switch).
    manager.onCollapseTreeItem({
      itemId: "foo",
      documentId: document,
      allParentIds: new Set(["foo", "bar"]),
    });

    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "foo" }),
      Collapsed,
      "Collapsed item must report Collapsed"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "bar" }),
      Expanded,
      "Untouched sibling defaults to Expanded in collapsedItemIds mode"
    );

    // Expand "foo" again -> removed from the collapsed set -> back to Expanded.
    manager.onExpandTreeItem({
      itemId: "foo",
      documentId: document,
      allParentIds: new Set(["foo", "bar"]),
    });
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "foo" }),
      Expanded,
      "Re-expanded item must report Expanded again"
    );

    manager.dispose();
  });

  test("onExpandAllTreeItems clears collapse state and stops persisting it", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "expandall-key");
    const document = docId("/proj/expandall.ts");

    manager.onCollapseTreeItem({
      itemId: "foo",
      documentId: document,
      allParentIds: new Set(["foo", "bar"]),
    });
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "foo" }),
      Collapsed
    );

    manager.onExpandAllTreeItems({ documentId: document });

    // Every item now defaults to Expanded (collapsedItemIds mode, empty set).
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "foo" }),
      Expanded,
      "After Expand All, previously-collapsed item is Expanded"
    );

    await manager.flush();
    // A default store (collapsedItemIds + empty set) must not be persisted.
    assert.strictEqual(
      memento.get("expandall-key"),
      undefined,
      "Expand All returns the doc to default -> nothing persisted"
    );

    manager.dispose();
  });

  test("collapse-all triggers a mode switch to expandedItemIds (both directions round-trip)", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "modeswitch-key");
    const document = docId("/proj/modeswitch.ts");
    const allParentIds = new Set(["p1", "p2"]);

    // Collapse EVERY parent. Once the set covers all parents, the debounced
    // clean pass switches storage mode to expandedItemIds and clears the set
    // (storing "which items are expanded" is cheaper when nothing is expanded).
    manager.onCollapseTreeItem({ itemId: "p1", documentId: document, allParentIds });
    manager.onCollapseTreeItem({ itemId: "p2", documentId: document, allParentIds });

    // Before the clean debounce fires, mode is still collapsedItemIds with both ids.
    await manager.flush(); // flush cancels the pending clean pass; assert pre-switch state
    let written = memento.get("modeswitch-key") as Record<string, SerializedStore>;
    let store = written[document];
    assertExists(store, "modeswitch doc must have a persisted store before the switch");
    assert.strictEqual(store.storageMode, "collapsedItemIds");
    assert.deepStrictEqual(
      store.itemIds.slice().sort(),
      ["p1", "p2"],
      "Before the clean pass, both collapsed ids are stored explicitly"
    );

    // Re-drive the collapse so the per-document clean debouncer is armed, then
    // wait past its 2000ms delay so the mode switch actually runs.
    manager.onCollapseTreeItem({ itemId: "p1", documentId: document, allParentIds });
    manager.onCollapseTreeItem({ itemId: "p2", documentId: document, allParentIds });
    await delay(2500);
    await manager.saveToWorkspaceState();

    written = memento.get("modeswitch-key") as Record<string, SerializedStore>;
    store = written[document];
    assertExists(store, "modeswitch doc must have a persisted store after the switch");
    assert.strictEqual(
      store.storageMode,
      "expandedItemIds",
      "All-parents-collapsed must switch storage mode to expandedItemIds"
    );
    assert.deepStrictEqual(
      store.itemIds,
      [],
      "After the switch the id set is empty (nothing is expanded)"
    );

    // Both parents still read as Collapsed even though the set is empty, because
    // expandedItemIds mode defaults absent items to Collapsed.
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "p1" }),
      Collapsed,
      "In expandedItemIds mode, an id NOT in the set is Collapsed"
    );

    // Round-trip the other direction: expanding p1 now ADDS it to the set.
    manager.onExpandTreeItem({ itemId: "p1", documentId: document, allParentIds });
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "p1" }),
      Expanded,
      "Expanding in expandedItemIds mode makes p1 report Expanded"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: document, itemId: "p2" }),
      Collapsed,
      "p2 stays Collapsed (still not in the expanded set)"
    );

    manager.dispose();
  });

  test("load-from-serialized-state: constructor rehydrates both storage modes", () => {
    const collapsedModeDoc = docId("/proj/loaded-collapsed.ts");
    const expandedModeDoc = docId("/proj/loaded-expanded.ts");
    const seeded: Record<string, SerializedStore> = {
      [collapsedModeDoc]: { storageMode: "collapsedItemIds", itemIds: ["a"] },
      [expandedModeDoc]: { storageMode: "expandedItemIds", itemIds: ["x"] },
    };
    const memento = new TestMemento(new Map<string, unknown>([["load-key", seeded]]));

    // Constructor calls loadFromWorkspaceState().
    const manager = new CollapsibleStateManager(memento, "load-key");

    // collapsedItemIds mode: "a" is collapsed, everything else Expanded.
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: collapsedModeDoc, itemId: "a" }),
      Collapsed,
      "Serialized collapsed id 'a' must load as Collapsed"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: collapsedModeDoc, itemId: "z" }),
      Expanded,
      "Non-serialized id in collapsed-mode doc defaults to Expanded"
    );

    // expandedItemIds mode: "x" is expanded, everything else Collapsed.
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: expandedModeDoc, itemId: "x" }),
      Expanded,
      "Serialized expanded id 'x' must load as Expanded"
    );
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: expandedModeDoc, itemId: "z" }),
      Collapsed,
      "Non-serialized id in expanded-mode doc defaults to Collapsed"
    );

    manager.dispose();
  });

  test("undefined documentId yields undefined (no throw)", () => {
    const manager = new CollapsibleStateManager(new TestMemento(), "undef-key");
    assert.strictEqual(
      manager.getSavedCollapsibleState({ documentId: undefined, itemId: "foo" }),
      undefined
    );
    manager.dispose();
  });
});
