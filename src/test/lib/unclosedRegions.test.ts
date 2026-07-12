import * as assert from "assert";
import * as vscode from "vscode";
import { parseAllRegions } from "../../lib/parseAllRegions";
import { RegionFoldingProvider } from "../../lib/RegionFoldingProvider";
import { type RegionStore } from "../../state/RegionStore";
import { assertExists } from "../../utils/assertUtils";

/**
 * Plan 6.10 — unclosed regions are represented (extended to their last closed
 * child's end, or EOF) instead of being silently dropped, so they stay visible
 * and foldable while STILL flagged invalid.
 */
suite("Unclosed region representation (plan 6.10)", function () {
  this.timeout(10000);

  async function openTs(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ content, language: "typescript" });
  }

  /** A fake store so RegionFoldingProvider parses the passed doc from scratch. */
  function makeFoldingProvider(): { provider: RegionFoldingProvider; dispose: () => void } {
    const emitter = new vscode.EventEmitter<void>();
    const fakeStore = {
      onDidChangeRegions: emitter.event,
      documentId: undefined,
      topLevelRegions: [],
    } as unknown as RegionStore;
    const provider = new RegionFoldingProvider(fakeStore);
    const dispose = (): void => {
      provider.dispose();
      emitter.dispose();
    };
    return { provider, dispose };
  }

  function foldingRangesFor(document: vscode.TextDocument): vscode.FoldingRange[] {
    const { provider, dispose } = makeFoldingProvider();
    try {
      return provider.provideFoldingRanges(
        document,
        {} as vscode.FoldingContext,
        new vscode.CancellationTokenSource().token
      );
    } finally {
      dispose();
    }
  }

  test("unclosed region with a closed child extends to that child's end and keeps it nested", async () => {
    // Line 0: Outer opens (never closed). Lines 1-3: Inner opens+closes. Line 4: trailing content.
    const content = [
      "// #region Outer",
      "// #region Inner",
      "const a = 1;",
      "// #endregion",
      "const b = 2;",
    ].join("\n");
    const document = await openTs(content);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 1, "the unclosed Outer region stays at the top level");
    const [outer] = topLevelRegions;
    assert.ok(outer);
    assert.strictEqual(outer.name, "Outer");
    assert.strictEqual(outer.wasClosed, false, "still flagged invalid (unclosed)");
    assert.strictEqual(outer.range.start.line, 0);
    assert.strictEqual(
      outer.range.end.line,
      3,
      "extends to its last closed child's end (the #endregion line), NOT EOF"
    );

    assert.strictEqual(outer.children.length, 1, "the closed child is kept nested, not promoted");
    const [inner] = outer.children;
    assert.ok(inner);
    assert.strictEqual(inner.name, "Inner");
    assert.strictEqual(inner.parent, outer);

    // Still produces exactly one invalid (unclosed-start) marker at the Outer start.
    assert.strictEqual(invalidMarkers.length, 1);
    const [outerMarker] = invalidMarkers;
    assertExists(outerMarker);
    assert.strictEqual(outerMarker.boundaryType, "start");
    assert.strictEqual(outerMarker.lineIdx, 0);

    // Folding ranges are produced for both the unclosed Outer and the Inner region.
    const ranges = foldingRangesFor(document);
    const outerRange = ranges.find((r) => r.start === 0);
    assert.ok(outerRange, "a folding range is produced for the unclosed region");
    assert.strictEqual(outerRange.end, 3);
    assert.ok(ranges.some((r) => r.start === 1 && r.end === 3), "child region is foldable too");
  });

  test("unclosed region with no children extends to EOF", async () => {
    const content = ["// #region Lonely", "const a = 1;", "const b = 2;"].join("\n");
    const document = await openTs(content);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 1);
    const [region] = topLevelRegions;
    assert.ok(region);
    assert.strictEqual(region.name, "Lonely");
    assert.strictEqual(region.wasClosed, false);
    assert.strictEqual(region.children.length, 0);
    assert.strictEqual(region.range.start.line, 0);
    assert.strictEqual(
      region.range.end.line,
      document.lineCount - 1,
      "with no closed children the region extends to the last line (EOF)"
    );

    assert.strictEqual(invalidMarkers.length, 1);
    const [marker] = invalidMarkers;
    assertExists(marker);
    assert.strictEqual(marker.boundaryType, "start");

    const ranges = foldingRangesFor(document);
    assert.ok(
      ranges.some((r) => r.start === 0 && r.end === document.lineCount - 1),
      "the EOF-extended unclosed region is foldable"
    );
  });
});
