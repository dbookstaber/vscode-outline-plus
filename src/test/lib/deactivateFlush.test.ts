import * as assert from "assert";
import type * as vscode from "vscode";
import { CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { delay } from "../utils/waitForEvent";

/**
 * Tests for CODE_REVIEW_MAY #10 — pending workspace-state writes must be
 * persisted before extension teardown. Both `CollapsibleStateManager` and
 * `RegionsViewAutoHideManager` previously made fire-and-forget
 * `workspaceState.update()` calls, allowing up to ~15 seconds of state to
 * be lost on host shutdown.
 *
 * `flush()` exposes an awaitable persistence path that the extension's async
 * `deactivate()` invokes.
 */
suite("CollapsibleStateManager.flush (CODE_REVIEW_MAY #10)", function () {
  this.timeout(10000);

  /**
   * Minimal in-memory Memento that lets us observe whether updates have
   * actually been awaited.
   */
  class TestMemento implements vscode.Memento {
    private readonly storage = new Map<string, unknown>();
    public updateCount = 0;
    public updateResolutions = 0;
    public lastWritten: unknown;
    /** When set, `update()` returns a deferred promise we control. */
    public deferUpdate = false;
    private pendingResolvers: (() => void)[] = [];

    keys(): readonly string[] {
      return Array.from(this.storage.keys());
    }
    // Memento.get is overloaded; we just need a single implementation that
    // satisfies both signatures. Using `any` here is intentional — the type
    // safety is enforced at the callers' assertion sites.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get(key: string, defaultValue?: unknown): any {
      return this.storage.has(key)
        ? this.storage.get(key)
        : defaultValue;
    }
    update(key: string, value: unknown): Thenable<void> {
      this.updateCount += 1;
      this.lastWritten = value;
      if (value === undefined) {
        this.storage.delete(key);
      } else {
        this.storage.set(key, value);
      }
      if (this.deferUpdate) {
        return new Promise<void>((resolve) => {
          this.pendingResolvers.push(() => {
            this.updateResolutions += 1;
            resolve();
          });
        });
      }
      this.updateResolutions += 1;
      return Promise.resolve();
    }
    flushPending(): void {
      const resolvers = this.pendingResolvers.splice(0);
      for (const r of resolvers) r();
    }
    setKeysForSync(): void {
      // no-op
    }
  }

  test("flush() resolves the persisted state and returns only after update completes", async () => {
    const memento = new TestMemento();
    memento.deferUpdate = true;
    const manager = new CollapsibleStateManager(memento, "test-key");

    // Trigger a state mutation that schedules a debounced save.
    manager.onCollapseTreeItem({
      itemId: "item-A",
      documentId: "doc-1",
      allParentIds: new Set(["item-A"]),
    });

    // Kick off flush; it should NOT resolve until our deferred update resolves.
    const flushPromise = manager.flush();
    let flushDone = false;
    void flushPromise.then(() => { flushDone = true; });

    await delay(50);
    assert.strictEqual(flushDone, false,
      "flush() must not resolve until the workspace state update settles");
    assert.strictEqual(memento.updateCount, 1, "Update should have been initiated");
    assert.strictEqual(memento.updateResolutions, 0, "Update has not yet resolved");

    // Resolve the in-flight update; flush should now complete.
    memento.flushPending();
    await flushPromise;
    assert.strictEqual(memento.updateResolutions, 1, "Update resolved exactly once");
    assert.strictEqual(flushDone, true, "flush() must resolve after update resolves");

    manager.dispose();
  });

  test("flush() persists state even if dispose() was about to be called", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "test-key-2");

    manager.onCollapseTreeItem({
      itemId: "item-B",
      documentId: "doc-2",
      allParentIds: new Set(["item-B"]),
    });

    await manager.flush();
    assert.strictEqual(memento.updateCount, 1,
      "flush() should have persisted exactly once");

    // The persisted value should reflect the collapse we recorded.
    const written = memento.get("test-key-2") as
      | Record<string, { storageMode: string; itemIds: string[] }>
      | undefined;
    assert.ok(written, "Expected the workspace state to contain a serialized entry");
    const doc2 = written["doc-2"];
    assert.ok(doc2, "Expected an entry for doc-2");
    assert.deepStrictEqual(doc2.itemIds, ["item-B"]);

    manager.dispose();
  });

  test("flush() is safe to call when there is nothing pending", async () => {
    const memento = new TestMemento();
    const manager = new CollapsibleStateManager(memento, "test-key-3");

    // With no mutations, the store has only a default state. flush() should
    // still resolve cleanly (saveToWorkspaceState handles empty payloads).
    await manager.flush();
    // updateCount could be 0 or 1 depending on whether we cleared the key.
    // The point is it should not throw or hang.
    assert.ok(memento.updateCount <= 1);

    manager.dispose();
  });
});
