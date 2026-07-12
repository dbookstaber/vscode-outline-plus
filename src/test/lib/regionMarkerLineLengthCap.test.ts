import * as assert from "assert";
import * as vscode from "vscode";
import {
  MAX_REGION_MARKER_LINE_LENGTH,
  parseAllRegions,
} from "../../lib/parseAllRegions";

/**
 * Plan 6.1 — per-line length cap in the region-boundary matcher (ReDoS
 * defense-in-depth).
 *
 * `matchLineWithRegexOrArray` refuses to run any region pattern against a line
 * longer than {@link MAX_REGION_MARKER_LINE_LENGTH}. Region markers are always
 * short comment lines, so the documented, least-surprising semantics are: a
 * `#region` / `#endregion` marker sitting on an over-long line is ignored (it
 * does not open or close a region and is not flagged as an invalid marker).
 *
 * Documents are built in memory so the exact line length is under test control.
 */
suite("Plan 6.1 — over-long region-marker lines are ignored (ReDoS cap)", function () {
  this.timeout(10000);

  async function openTs(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ content, language: "typescript" });
  }

  /**
   * Pads a `// #region` start marker out to `totalLength` characters by appending
   * spaces after the region name. The default start pattern captures the name via
   * `(.*?)` and tolerates trailing whitespace, so padding keeps the line a valid
   * marker *shape* — only the length gate should decide whether it matches.
   */
  function regionLineOfLength(totalLength: number): string {
    const base = "// #region Padded";
    assert.ok(totalLength >= base.length, "test helper: requested length too small");
    return base + " ".repeat(totalLength - base.length);
  }

  test("a start marker on a line at the cap still opens a region", async () => {
    const startLine = regionLineOfLength(MAX_REGION_MARKER_LINE_LENGTH);
    assert.strictEqual(startLine.length, MAX_REGION_MARKER_LINE_LENGTH, "precondition: line is exactly at the cap");
    const document = await openTs(`${startLine}\nconst x = 1;\n// #endregion`);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 1, "a marker exactly at the cap is scanned normally");
    assert.strictEqual(topLevelRegions[0]?.name, "Padded");
    assert.strictEqual(invalidMarkers.length, 0);
  });

  test("a start marker one character over the cap is ignored (no region opened)", async () => {
    const startLine = regionLineOfLength(MAX_REGION_MARKER_LINE_LENGTH + 1);
    assert.strictEqual(startLine.length, MAX_REGION_MARKER_LINE_LENGTH + 1, "precondition: line is one over the cap");
    const document = await openTs(`${startLine}\nconst x = 1;\n// #endregion`);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    // The start marker is skipped, so the lone #endregion has no open region to
    // close and is reported as a single invalid end marker.
    assert.strictEqual(topLevelRegions.length, 0, "an over-long start marker opens no region");
    assert.deepStrictEqual(
      invalidMarkers,
      [{ boundaryType: "end", lineIdx: 2 }],
      "the trailing #endregion is unmatched because the over-long start was ignored"
    );
  });

  test("an over-long end marker is ignored, leaving the region unclosed", async () => {
    // Pad the #endregion line past the cap; the start marker is normal length.
    const endBase = "// #endregion";
    const endLine = endBase + " ".repeat(MAX_REGION_MARKER_LINE_LENGTH + 1 - endBase.length);
    const document = await openTs(`// #region Alpha\nconst x = 1;\n${endLine}`);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    // The end marker is skipped, so the opened region is never closed. Under
    // plan 6.10's unclosed-region representation the region still appears in
    // the tree (extending to end-of-file) but is flagged with an invalid start
    // marker — proving the over-long #endregion was ignored.
    assert.strictEqual(topLevelRegions.length, 1, "the unclosed region is represented in the tree");
    const unclosedRegion = topLevelRegions[0];
    assert.ok(unclosedRegion, "sanity: the region exists");
    assert.strictEqual(unclosedRegion.name, "Alpha");
    assert.strictEqual(unclosedRegion.wasClosed, false, "the region must be unclosed — its end marker was ignored");
    assert.strictEqual(
      unclosedRegion.range.end.line,
      document.lineCount - 1,
      "a childless unclosed region extends to end-of-file"
    );
    assert.deepStrictEqual(
      invalidMarkers,
      [{ boundaryType: "start", lineIdx: 0 }],
      "the opened region is flagged unclosed because the over-long #endregion was ignored"
    );
  });
});
