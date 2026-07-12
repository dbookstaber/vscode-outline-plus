import * as assert from "assert";

import { flattenRegionsAndCountParents } from "../../lib/flattenRegions";
import { parseAllRegions } from "../../lib/parseAllRegions";
import { openSampleDocument } from "../utils/openSampleDocument";

suite("flattenRegions", () => {
  test("Flatten regions in the sample document", async () => {
    const sampleDocument = await openSampleDocument("sampleRegionsDocument.ts");
    const { topLevelRegions } = parseAllRegions(sampleDocument);
    const { flattenedRegions, allParentIds } = flattenRegionsAndCountParents(topLevelRegions);
    assert.strictEqual(flattenedRegions.length, 9);
    assert.strictEqual(allParentIds.size, 3);
    const regionNames = flattenedRegions.map((region) => region.name);
    assert.deepStrictEqual(regionNames, [
      "Imports",
      "Classes",
      "Constructor",
      "Methods",
      "Nested Method Region",
      "Sibling Classes",
      "Another Nested Region",
      "Type Definitions",
      undefined,
    ]);
    const flatIndices = flattenedRegions.map((region) => region.flatRegionIdx);
    assert.deepStrictEqual(flatIndices, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    // Nesting depth (plan 4.6): 0 for top-level, +1 per nesting level. Mirrors
    // the ancestor count (getRegionParents length) the quick-pick used to derive
    // by re-walking each region's parent chain.
    const depths = flattenedRegions.map((region) => region.depth);
    assert.deepStrictEqual(depths, [0, 0, 1, 1, 2, 1, 2, 0, 0]);
  });
});
