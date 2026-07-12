/**
 * Benchmark utilities for measuring Outline++ extension performance.
 *
 * Used by the opt-in timing suite in `performanceBenchmarks.test.ts`.
 */

/**
 * Generates a large test file content with many regions for stress testing.
 */
export function generateLargeTestFile(lineCount: number, regionCount: number): string {
  const lines: string[] = [];
  const linesPerRegion = Math.floor(lineCount / regionCount);

  for (let r = 0; r < regionCount; r++) {
    lines.push(`// #region Region${r + 1}`);

    for (let l = 0; l < linesPerRegion - 2; l++) {
      lines.push(`const var${r}_${l} = ${l};`);
    }

    lines.push(`// #endregion`);
  }

  return lines.join("\n");
}
