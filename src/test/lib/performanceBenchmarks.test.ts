/**
 * Timing benchmarks for Outline++ extension performance.
 *
 * These print timing tables and stress the parser; they are NOT part of the
 * correctness gate (behavioral event-precision guarantees live in
 * `eventFiringPrecision.test.ts`). They sleep real timers for many seconds, so
 * the whole suite is OPT-IN: it only runs when the `OUTLINE_PLUS_BENCH`
 * environment variable is set, and is otherwise skipped.
 *
 * Run with: `npm run bench` (or set OUTLINE_PLUS_BENCH=1 before `npm test`).
 */

import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlineInternalAPI } from "../../api/regionHelperAPI";
import { DEBOUNCE_DOCUMENT_PARSE_MS } from "../../constants";
import { flattenRegionsAndCountParents } from "../../lib/flattenRegions";
import { parseAllRegions } from "../../lib/parseAllRegions";
import { generateLargeTestFile } from "../utils/benchmarkUtils";

/**
 * Helper to wait for a short duration (for debounced operations to settle).
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait time for debounced operations to settle.
 * Derived from DEBOUNCE_DOCUMENT_PARSE_MS so a future debounce tweak does
 * not silently break this test.
 */
const DEBOUNCE_SETTLE_MS = DEBOUNCE_DOCUMENT_PARSE_MS + 150;

suite("Performance Benchmarks", function () {
  const timeout = 60000; // 60 second timeout for performance tests
  let regionHelperAPI: OutlineInternalAPI;

  // Opt-in only: skip the entire (slow) benchmark suite unless explicitly
  // requested. Keeps the default `npm test` gate fast and network-free.
  suiteSetup(async function () {
    if (process.env["OUTLINE_PLUS_BENCH"] === undefined) {
      this.skip();
    }
    const ext = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!ext) {
      throw new Error("Outline++ extension not found!");
    }
    await ext.activate();
    regionHelperAPI = ext.exports as OutlineInternalAPI;
  });

  /**
   * Test region parsing performance with different file sizes.
   * This directly measures parseAllRegions() performance.
   */
  test("Region parsing performance - various file sizes", async function () {
    this.timeout(timeout);

    const sizes = [
      { lines: 100, regions: 5, name: "Small (100 lines)" },
      { lines: 500, regions: 25, name: "Medium (500 lines)" },
      { lines: 1000, regions: 50, name: "Large (1000 lines)" },
      { lines: 2000, regions: 100, name: "XLarge (2000 lines)" },
    ];

    console.log("\n=== Region Parsing Performance ===\n");
    console.log("| File Size | Regions | Parse Time (avg) | Flatten Time (avg) |");
    console.log("|-----------|---------|------------------|-------------------|");

    for (const size of sizes) {
      const content = generateLargeTestFile(size.lines, size.regions);
      const doc = await vscode.workspace.openTextDocument({
        content,
        language: "typescript",
      });

      const parseTimes: number[] = [];
      const flattenTimes: number[] = [];

      // Measure parsing time
      for (let i = 0; i < 10; i++) {
        const parseStart = performance.now();
        const { topLevelRegions } = parseAllRegions(doc);
        const parseEnd = performance.now();
        parseTimes.push(parseEnd - parseStart);

        const flattenStart = performance.now();
        flattenRegionsAndCountParents(topLevelRegions);
        const flattenEnd = performance.now();
        flattenTimes.push(flattenEnd - flattenStart);
      }

      const avgParseTime = parseTimes.reduce((a, b) => a + b, 0) / parseTimes.length;
      const avgFlattenTime = flattenTimes.reduce((a, b) => a + b, 0) / flattenTimes.length;
      console.log(
        `| ${size.name} | ${size.regions} | ${avgParseTime.toFixed(2)}ms | ${avgFlattenTime.toFixed(2)}ms |`
      );

      // Basic assertion - parsing should complete in reasonable time
      assert.ok(avgParseTime < 5000, `Parsing took too long for ${size.name}: ${avgParseTime}ms`);
    }
  });

  /**
   * Test that events DO fire when regions actually change.
   */
  test("Event firing - actual region changes", async function () {
    this.timeout(timeout);

    const initialContent = `// #region A\nconst a = 1;\n// #endregion`;

    const doc = await vscode.workspace.openTextDocument({
      content: initialContent,
      language: "typescript",
    });
    const editor = await vscode.window.showTextDocument(doc);

    // Wait for initial parse
    await wait(DEBOUNCE_SETTLE_MS);

    let regionEventCount = 0;
    const regionDisposable = regionHelperAPI.onDidChangeRegions(() => {
      regionEventCount++;
    });

    try {
      // Add a new region - this SHOULD trigger an event
      await editor.edit((editBuilder) => {
        editBuilder.insert(
          new vscode.Position(3, 0),
          "\n// #region B\nconst b = 2;\n// #endregion"
        );
      });

      await wait(DEBOUNCE_SETTLE_MS); // Wait for debounced refresh

      console.log(`\nAfter adding a new region:`);
      console.log(`  Region events fired: ${regionEventCount}`);

      // Events SHOULD fire when regions change
      assert.ok(
        regionEventCount > 0,
        `Expected events to fire for region changes, got ${regionEventCount}`
      );
    } finally {
      regionDisposable.dispose();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  });

  /**
   * Stress test - many rapid edits to the same document.
   */
  test("Stress test - rapid sequential edits", async function () {
    this.timeout(timeout);

    const initialContent = `// #region Stress\nconst x = 0;\n// #endregion`;

    const doc = await vscode.workspace.openTextDocument({
      content: initialContent,
      language: "typescript",
    });
    const editor = await vscode.window.showTextDocument(doc);

    // Wait for initial parse
    await wait(DEBOUNCE_SETTLE_MS);

    let eventCount = 0;
    const disposable = regionHelperAPI.onDidChangeRegions(() => {
      eventCount++;
    });

    try {
      const editCount = 20;
      const startTime = performance.now();

      for (let i = 0; i < editCount; i++) {
        // Change a value inside the region
        await editor.edit((editBuilder) => {
          editBuilder.replace(
            new vscode.Range(new vscode.Position(1, 12), new vscode.Position(1, 13)),
            String(i % 10)
          );
        });
        // Small wait to allow processing
        await wait(20);
      }

      // Wait for final debounced updates
      await wait(DEBOUNCE_SETTLE_MS);

      const totalTime = performance.now() - startTime;

      console.log(`\n=== Stress Test Results ===`);
      console.log(`  Total edits: ${editCount}`);
      console.log(`  Total time: ${totalTime.toFixed(2)}ms`);
      console.log(`  Avg time per edit: ${(totalTime / editCount).toFixed(2)}ms`);
      console.log(`  Events fired: ${eventCount}`);
      console.log(`  Event ratio: ${((eventCount / editCount) * 100).toFixed(1)}%`);

      // Should complete in reasonable time
      assert.ok(totalTime < 30000, `Stress test took too long: ${totalTime}ms`);
    } finally {
      disposable.dispose();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  });
});
