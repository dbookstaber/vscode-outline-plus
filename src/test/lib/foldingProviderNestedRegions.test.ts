import * as assert from "assert";
import * as vscode from "vscode";
import { RegionFoldingProvider } from "../../lib/RegionFoldingProvider";
import { refreshRegionBoundaryPatternMap } from "../../lib/regionBoundaryPatterns";
import { type RegionStore } from "../../state/RegionStore";

/**
 * Plan 5.5: `collectFoldingRanges`' child-traversal branch (pushing each region's
 * children onto the stack) was never exercised by any test. This drives a
 * three-level nested sample through the provider and asserts the exact fold
 * ranges — parent, child, and grandchild — proving nested regions fold.
 *
 * The sample document is opened but NOT made the active editor, so the provider
 * takes its parse fallback path (which runs the full nested parse + traversal),
 * independent of any RegionStore cache.
 */
suite("RegionFoldingProvider nested regions (plan 5.5)", function () {
  this.timeout(10000);

  // A no-op store: the parse fallback path never reads it, but the provider
  // constructor subscribes to onDidChangeRegions.
  function makeNoopStore(): { store: RegionStore; dispose: () => void } {
    const emitter = new vscode.EventEmitter<void>();
    const store = {
      get documentId() {
        return undefined;
      },
      get topLevelRegions() {
        return [];
      },
      onDidChangeRegions: emitter.event,
    } as unknown as RegionStore;
    return { store, dispose: () => emitter.dispose() };
  }

  function rangeKey(r: vscode.FoldingRange): string {
    return `${r.start}-${r.end}`;
  }

  test("folds parent, child, and grandchild regions with exact ranges", async () => {
    refreshRegionBoundaryPatternMap();

    // csharp default pattern: #region <name> / #endregion. Three nesting levels:
    //   Outer (0..11) → Middle (2..6) → Leaf (3..5), plus sibling child (7..9).
    const lines = [
      "#region Outer", // 0
      "class A {", // 1
      "    #region Middle", // 2
      "        #region Leaf", // 3
      "        void M() {}", // 4
      "        #endregion", // 5
      "    #endregion", // 6
      "    #region Sibling", // 7
      "    void N() {}", // 8
      "    #endregion", // 9
      "}", // 10
      "#endregion", // 11
    ];
    const doc = await vscode.workspace.openTextDocument({
      content: lines.join("\n"),
      language: "csharp",
    });
    // Intentionally do NOT showTextDocument(doc): keep it non-active so the
    // provider parses it (exercising collectFoldingRanges' child traversal)
    // rather than consulting a store cache.

    const { store, dispose } = makeNoopStore();
    const provider = new RegionFoldingProvider(store);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    const actual = ranges.map(rangeKey).sort();
    const expected = ["0-11", "2-6", "3-5", "7-9"].sort();
    assert.deepStrictEqual(
      actual,
      expected,
      "Nested regions must produce exact fold ranges for Outer/Middle/Leaf/Sibling"
    );

    // Every fold range must carry the Region kind.
    for (const r of ranges) {
      assert.strictEqual(r.kind, vscode.FoldingRangeKind.Region);
    }

    provider.dispose();
    dispose();
  });
});
