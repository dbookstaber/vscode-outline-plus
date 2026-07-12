import * as assert from "assert";
import * as vscode from "vscode";
import { parseAllRegions } from "../../lib/parseAllRegions";
import { RegionStore } from "../../state/RegionStore";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Plan 5.6 — exercise the large-file bail-out boundary in `parseAllRegions`.
 *
 * The guard is `if (document.lineCount > LARGE_FILE_LINE_THRESHOLD) return empty`
 * with `LARGE_FILE_LINE_THRESHOLD = 100_000`. Because the comparison is strictly
 * `>`, the exact boundary is:
 *   - 100_000 lines  -> parses (NOT greater than the threshold)
 *   - 100_001 lines  -> bails out (empty result)
 *
 * (The plan's "99,999 parses / 100,001 empty" wording was approximate; the real
 * off-by-nothing boundary sits at 100_000 vs 100_001, which these tests pin.)
 *
 * Documents are built in-memory so the byte-exact line count is under our control
 * and no fixture file has to be committed.
 */
suite("Plan 5.6 — parseAllRegions large-file bail-out boundary", function () {
  this.timeout(30000);

  /**
   * Builds TypeScript content with exactly `lineCount` lines: a single named
   * region ("Boundary") on the first two lines, then filler. A string with
   * `lineCount - 1` newlines has `lineCount` lines, which VS Code reports as
   * `document.lineCount`.
   */
  function buildContentWithLineCount(lineCount: number): string {
    const lines: string[] = ["// #region Boundary", "// #endregion"];
    for (let i = 2; i < lineCount; i++) {
      lines.push(`const v${i} = ${i};`);
    }
    return lines.join("\n");
  }

  async function openInMemory(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ content, language: "typescript" });
  }

  test("exactly 100_000 lines still parses regions (at the boundary, not over it)", async () => {
    const document = await openInMemory(buildContentWithLineCount(100_000));
    assert.strictEqual(document.lineCount, 100_000, "Precondition: document has exactly 100_000 lines");

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 1, "100_000-line file must be parsed");
    assert.strictEqual(topLevelRegions[0]?.name, "Boundary");
    assert.strictEqual(invalidMarkers.length, 0);
  });

  test("exactly 100_000 lines does not flag a large-file bail-out", async () => {
    const document = await openInMemory(buildContentWithLineCount(100_000));
    const { bailedOutOnLargeFile } = parseAllRegions(document);
    assert.strictEqual(bailedOutOnLargeFile, false, "at the boundary, parsing proceeds");
  });

  test("100_001 lines bails out and returns no regions", async () => {
    const document = await openInMemory(buildContentWithLineCount(100_001));
    assert.strictEqual(document.lineCount, 100_001, "Precondition: document has exactly 100_001 lines");

    const { topLevelRegions, invalidMarkers, bailedOutOnLargeFile } = parseAllRegions(document);

    assert.strictEqual(
      topLevelRegions.length,
      0,
      "One line over the threshold must bail out (empty regions), even though a real region exists at the top"
    );
    assert.strictEqual(invalidMarkers.length, 0, "Bail-out returns empty invalid markers too");
    assert.strictEqual(bailedOutOnLargeFile, true, "over the threshold flags the bail-out signal");
  });

  /**
   * Plan 6.10 — store-level bail-out signal. The status-bar UI is a thin
   * projection of `RegionStore.didBailOutOnLargeFile`; this pins the flag +
   * transition event (the testable source of truth) rather than the UI.
   */
  suite("RegionStore.didBailOutOnLargeFile signal", () => {
    let subscriptions: vscode.Disposable[];
    let store: RegionStore;

    setup(() => {
      subscriptions = [];
      store = new RegionStore(subscriptions);
    });

    teardown(async () => {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    async function showAndForceRefresh(document: vscode.TextDocument): Promise<void> {
      await vscode.window.showTextDocument(document);
      await waitForCondition(
        () => vscode.window.activeTextEditor?.document === document,
        3000,
        25
      );
      store.forceRefresh();
    }

    test("flag is false for a normal file and true for an over-threshold file, firing on transition", async () => {
      let bailoutEvents = 0;
      subscriptions.push(store.onDidChangeLargeFileBailout(() => bailoutEvents++));

      const smallDoc = await openInMemory(buildContentWithLineCount(10));
      await showAndForceRefresh(smallDoc);
      assert.strictEqual(store.didBailOutOnLargeFile, false, "normal file: no bail-out");
      assert.strictEqual(bailoutEvents, 0, "no transition yet (started false)");

      const hugeDoc = await openInMemory(buildContentWithLineCount(100_001));
      await showAndForceRefresh(hugeDoc);
      assert.strictEqual(store.didBailOutOnLargeFile, true, "over-threshold file: bailed out");
      assert.strictEqual(bailoutEvents, 1, "the false→true transition fired exactly once");

      await showAndForceRefresh(smallDoc);
      assert.strictEqual(store.didBailOutOnLargeFile, false, "back to a normal file: cleared");
      assert.strictEqual(bailoutEvents, 2, "the true→false transition fired");
    });
  });
});
