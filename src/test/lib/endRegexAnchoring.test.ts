import * as assert from "assert";

import { parseAllRegions } from "../../lib/parseAllRegions";
import { assertExists } from "../../utils/assertUtils";
import { openSampleDocument } from "../utils/openSampleDocument";

/**
 * Regression test for Plan 2.4 — the default `endRegex` patterns for hash-comment
 * languages (python, yaml, shellscript, dockerfile, …) were unanchored:
 * `^\s*#\s*endregion(?:\s.*)?` with no trailing `$`. That matched any line whose
 * text merely *began* with `# endregion`, so a prose line like
 * `# endregions handled below` prematurely closed the region.
 *
 * The fix appends `$` (matching the anchored C-family patterns). A line that only
 * has `endregion` as a substring of a longer word must NOT close a region.
 */
suite("Plan 2.4 — end-region patterns are anchored (do not match substrings)", () => {
  test("`# endregions handled below` does not close a python region", async () => {
    const document = await openSampleDocument("regressions", "endregionSubstring.py");

    const { topLevelRegions, invalidMarkers } = parseAllRegions(document);

    // Pre-fix: the `# endregions handled below` line (index 2) closed "Alpha"
    // early, leaving the real `# endregion` (index 4) as an unmatched end →
    // one invalid marker and a region ending on the wrong line.
    assert.strictEqual(
      invalidMarkers.length,
      0,
      "Substring 'endregions' line must not be treated as a region boundary"
    );
    assert.strictEqual(topLevelRegions.length, 1, "Expected exactly one region");

    const [region] = topLevelRegions;
    assertExists(region);
    assert.strictEqual(region.name, "Alpha");
    // The region must close on the genuine `# endregion` line (index 4), not on
    // the `# endregions handled below` line (index 2).
    assert.strictEqual(
      region.range.end.line,
      4,
      "Region should close on the real `# endregion` line, not the substring line"
    );
  });
});
