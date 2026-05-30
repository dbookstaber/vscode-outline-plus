import * as vscode from "vscode";
import { type Region } from "../models/Region";
import { type RegionStore } from "../state/RegionStore";
import { getVersionedDocumentId } from "./getVersionedDocumentId";
import { parseAllRegions } from "./parseAllRegions";

/**
 * Provides folding ranges based on region markers, allowing users to fold/unfold
 * regions directly in the editor using standard VS Code keyboard shortcuts.
 *
 * For the active document, reuses the cached parse from `RegionStore` (the
 * folding API is called frequently — on open, edit, every fold/unfold command —
 * and re-parsing every time is wasteful). For inactive documents (folding is
 * also resolved on background documents during certain VS Code operations) we
 * still parse on demand.
 */
export class RegionFoldingProvider implements vscode.FoldingRangeProvider {
  constructor(private regionStore: RegionStore) {}

  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    _token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    const topLevelRegions = this.getTopLevelRegionsFor(document);
    return collectFoldingRanges(topLevelRegions);
  }

  private getTopLevelRegionsFor(document: vscode.TextDocument): readonly Region[] {
    const activeDocument = vscode.window.activeTextEditor?.document;
    if (
      document === activeDocument &&
      this.regionStore.versionedDocumentId === getVersionedDocumentId(document)
    ) {
      return this.regionStore.topLevelRegions;
    }
    return parseAllRegions(document).topLevelRegions;
  }
}

function collectFoldingRanges(regions: readonly Region[]): vscode.FoldingRange[] {
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
