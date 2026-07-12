import * as assert from "assert";
import * as vscode from "vscode";
import { parseAllRegions } from "../../lib/parseAllRegions";
import { assertExists } from "../../utils/assertUtils";

/**
 * Plan 5.7 — sample-data edge cases (FUTURE_WORK May #29).
 *
 * Byte-sensitive inputs (BOM, CRLF, non-ASCII, regex metacharacters) are built
 * IN-MEMORY via `openTextDocument({ content, language })` so git / .gitattributes
 * line-ending normalization cannot silently rewrite a committed fixture's bytes.
 * The BOM is written as the `\uFEFF` escape (not a literal char) for the same
 * reason and to satisfy the no-irregular-whitespace lint rule.
 *
 * The lone `#endregion` case is covered here; the `# endregions handled below`
 * substring case already lives in `endRegexAnchoring.test.ts` (Plan 2.4) and is
 * intentionally NOT duplicated.
 *
 * Each case asserts the exact regions / invalid markers produced. If any case had
 * exposed a real parser bug it would be documented + skipped rather than fixed
 * here; all five pass against current parser behavior.
 */
suite("Plan 5.7 — parser edge cases (BOM, CRLF, unicode, regex-meta names, lone endregion)", function () {
  this.timeout(10000);

  async function openTs(content: string): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ content, language: "typescript" });
  }

  test("a BOM before the first region marker does not prevent parsing", async () => {
    // U+FEFF is whitespace to the `^\s*` prefix, so the BOM'd `// #region` still matches.
    const bom = String.fromCharCode(0xfeff);
    const document = await openTs(bom + "// #region Alpha\nconst x = 1;\n// #endregion");

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(invalidMarkers.length, 0, "BOM must not create a spurious invalid marker");
    assert.strictEqual(topLevelRegions.length, 1, "Region must still be found despite the leading BOM");
    const [region] = topLevelRegions;
    assertExists(region);
    assert.strictEqual(region.name, "Alpha", "Region name must be clean 'Alpha' (BOM not absorbed into it)");
    assert.strictEqual(region.range.end.line, 2, "Region should close on the #endregion line");
  });

  test("CRLF line endings are parsed identically to LF", async () => {
    const document = await openTs("// #region Beta\r\nconst y = 2;\r\n// #endregion");

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(invalidMarkers.length, 0);
    assert.strictEqual(topLevelRegions.length, 1);
    const [region] = topLevelRegions;
    assertExists(region);
    assert.strictEqual(region.name, "Beta", "CRLF must not leave a trailing CR in the captured name");
    assert.strictEqual(region.range.end.line, 2, "Region closes on line index 2 regardless of CRLF");
  });

  test("non-ASCII region names are captured verbatim", async () => {
    const unicodeName = "日本語 café ☕";
    const document = await openTs(`// #region ${unicodeName}\nbody();\n// #endregion`);

    const { topLevelRegions } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 1);
    const [region] = topLevelRegions;
    assertExists(region);
    assert.strictEqual(region.name, unicodeName, "Unicode region name must round-trip exactly");
    // The id is derived from the name; it must incorporate the unicode name too.
    assert.strictEqual(region.id, `${unicodeName}-1`);
  });

  test("regex-metacharacter region names are treated as literal text, not patterns", async () => {
    const metaName = "R(egion)+ [test]*";
    const document = await openTs(`// #region ${metaName}\nbody();\n// #endregion`);

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(invalidMarkers.length, 0);
    assert.strictEqual(topLevelRegions.length, 1);
    const [region] = topLevelRegions;
    assertExists(region);
    assert.strictEqual(
      region.name,
      metaName,
      "Regex metacharacters in a region name must be preserved literally"
    );
  });

  test("a lone #endregion with no matching start produces one invalid end marker", async () => {
    const document = await openTs("const z = 3;\n// #endregion\nconst w = 4;");

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    assert.strictEqual(topLevelRegions.length, 0, "No region opened, so none should be reported");
    assert.strictEqual(invalidMarkers.length, 1, "The unmatched #endregion is a single invalid marker");
    assert.deepStrictEqual(
      invalidMarkers[0],
      { boundaryType: "end", lineIdx: 1 },
      "Invalid marker must flag the end boundary on line index 1"
    );
  });
});
