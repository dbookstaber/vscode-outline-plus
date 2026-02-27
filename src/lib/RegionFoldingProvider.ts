import * as vscode from "vscode";
import { type Region } from "../models/Region";
import { parseAllRegions } from "./parseAllRegions";

/**
 * Provides folding ranges based on region markers, allowing users to fold/unfold
 * regions directly in the editor using standard VS Code keyboard shortcuts.
 */
export class RegionFoldingProvider implements vscode.FoldingRangeProvider {
  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    const { topLevelRegions } = parseAllRegions(document);
    return collectFoldingRanges(topLevelRegions);
  }
}

function collectFoldingRanges(regions: Region[]): vscode.FoldingRange[] {
  const ranges: vscode.FoldingRange[] = [];
  const stack: Region[] = [...regions];
  let region = stack.pop();
  while (region !== undefined) {
    ranges.push(
      new vscode.FoldingRange(
        region.range.start.line,
        region.range.end.line,
        vscode.FoldingRangeKind.Region
      )
    );
    for (const child of region.children) {
      stack.push(child);
    }
    region = stack.pop();
  }
  return ranges;
}
