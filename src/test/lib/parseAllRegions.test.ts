import * as assert from "assert";

import { parseAllRegions } from "../../lib/parseAllRegions";
import { assertExists } from "../../utils/assertUtils";
import {
  getAllFileNamesInSampleFolder,
  openInvalidSampleDocument,
  openValidSampleDocument,
} from "../utils/openSampleDocument";

suite("Parse files with only valid regions", () => {
  const validSamplesFolderName = "validSamples";
  const sampleFileNames = getAllFileNamesInSampleFolder(validSamplesFolderName);

  for (const sampleFileName of sampleFileNames) {
    test(`Parse regions in ${sampleFileName}`, async () => {
      const sampleDocument = await openValidSampleDocument(sampleFileName);

      const { topLevelRegions, invalidMarkers } = parseAllRegions(sampleDocument);

      const expectedTopLevelCount = 2;

      assert.strictEqual(topLevelRegions.length, expectedTopLevelCount, `Expected ${expectedTopLevelCount} top-level regions`);
      const [firstRegion, secondRegion] = topLevelRegions;
      assertExists(firstRegion);
      assertExists(secondRegion);
      assert.strictEqual(firstRegion.name, "FirstRegion");
      assert.strictEqual(firstRegion.regionIdx, 0);
      assert.strictEqual(secondRegion.name, "Second Region");
      assert.strictEqual(secondRegion.regionIdx, 1);

      assert.strictEqual(secondRegion.children.length, 2, "Expected 2 nested regions");
      const [subregion1, subregion2] = secondRegion.children;
      assertExists(subregion1);
      assertExists(subregion2);
      assert.strictEqual(subregion1.name, "InnerRegion");
      assert.strictEqual(subregion1.regionIdx, 0);
      assert.strictEqual(subregion2.name, undefined);
      assert.strictEqual(subregion2.regionIdx, 1);

      assert.strictEqual(invalidMarkers.length, 0, "Expected 0 invalid markers");
    });
  }
});

suite("Parse all regions with invalid markers", () => {
  const invalidSamplesFolderName = "invalidSamples";
  const invalidSampleFileNames = getAllFileNamesInSampleFolder(invalidSamplesFolderName);

  // Every invalid sample shares one shape: a valid closed "FirstRegion", a lone
  // invalid end boundary, then an unclosed "Invalid start boundary" region that
  // textually contains a fully-closed "Second Region" (which in turn nests
  // "InnerRegion" + one unnamed region).
  //
  // Plan 6.10: the unclosed "Invalid start boundary" region is no longer dropped
  // (with its closed child promoted to the top level). It is kept in the tree —
  // extended to its last closed child's end — so it stays visible and foldable,
  // while STILL flagged invalid via the "start" invalid marker. So the top level
  // is [FirstRegion, Invalid start boundary], and Second Region is a *child* of
  // the unclosed region rather than a promoted sibling.
  for (const invalidSampleFileName of invalidSampleFileNames) {
    test(`Parse valid and invalid regions in ${invalidSampleFileName}`, async () => {
      const invalidSampleDocument = await openInvalidSampleDocument(invalidSampleFileName);

      const { topLevelRegions, invalidMarkers } = parseAllRegions(invalidSampleDocument);

      assert.strictEqual(topLevelRegions.length, 2, "Expected 2 top-level regions");
      const [firstRegion, unclosedRegion] = topLevelRegions;
      assertExists(firstRegion);
      assertExists(unclosedRegion);
      assert.strictEqual(firstRegion.name, "FirstRegion");
      assert.strictEqual(firstRegion.regionIdx, 0);
      assert.strictEqual(firstRegion.wasClosed, true);

      // The unclosed region stays visible but is NOT marked closed.
      assert.strictEqual(unclosedRegion.name, "Invalid start boundary");
      assert.strictEqual(unclosedRegion.regionIdx, 1);
      assert.strictEqual(unclosedRegion.wasClosed, false);

      // It extends to its last closed child's end (Second Region's end line).
      assert.strictEqual(unclosedRegion.children.length, 1, "Unclosed region keeps its closed child");
      const [secondRegion] = unclosedRegion.children;
      assertExists(secondRegion);
      assert.strictEqual(secondRegion.name, "Second Region");
      assert.strictEqual(secondRegion.parent, unclosedRegion);
      assert.strictEqual(
        unclosedRegion.range.end.line,
        secondRegion.range.end.line,
        "Unclosed region extends to its last closed child's end line"
      );

      assert.strictEqual(secondRegion.children.length, 2, "Expected 2 nested regions");
      const [subregion1, subregion2] = secondRegion.children;
      assertExists(subregion1);
      assertExists(subregion2);
      assert.strictEqual(subregion1.name, "InnerRegion");
      assert.strictEqual(subregion1.regionIdx, 0);
      assert.strictEqual(subregion2.name, undefined);
      assert.strictEqual(subregion2.regionIdx, 1);

      assert.strictEqual(invalidMarkers.length, 2, "Expected 2 invalid markers");
      const [invalidEndMarker, invalidStartMarker] = invalidMarkers;
      assertExists(invalidEndMarker);
      assertExists(invalidStartMarker);
      assert.strictEqual(invalidEndMarker.boundaryType, "end");
      assert.strictEqual(invalidStartMarker.boundaryType, "start");
    });
  }
});
