import * as vscode from "vscode";
import { type Region } from "../models/Region";
import { type RegionStore } from "../state/RegionStore";
import { getDocumentId } from "./getVersionedDocumentId";
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
 *
 * The cache is served whenever the store holds the *same document* (URI), even
 * if its version lags the editor's current version. During an edit burst the
 * folding re-request lands inside the RegionStore parse-debounce window, so the
 * store's versioned id trails the live document by one or more revisions. A
 * version-exact gate would fall through to a second, undebounced from-scratch
 * parse on every such request. Instead we serve the (briefly stale) cached
 * ranges and fire `onDidChangeFoldingRanges` when the store catches up, so VS
 * Code re-requests and the ranges converge — without the redundant parse
 * (plan 4.1).
 */
export class RegionFoldingProvider implements vscode.FoldingRangeProvider, vscode.Disposable {
  private _onDidChangeFoldingRanges = new vscode.EventEmitter<void>();
  readonly onDidChangeFoldingRanges = this._onDidChangeFoldingRanges.event;
  private readonly storeSubscription: vscode.Disposable;

  constructor(private regionStore: RegionStore) {
    // When the store finishes a (debounced) reparse, tell VS Code to re-request
    // folding ranges so any stale-but-same-URI ranges we served mid-burst
    // converge to the freshly parsed result.
    this.storeSubscription = this.regionStore.onDidChangeRegions(() => {
      this._onDidChangeFoldingRanges.fire();
    });
  }

  dispose(): void {
    this.storeSubscription.dispose();
    this._onDidChangeFoldingRanges.dispose();
  }

  provideFoldingRanges(
    document: vscode.TextDocument,
    _context: vscode.FoldingContext,
    token: vscode.CancellationToken
  ): vscode.FoldingRange[] {
    // Honor cancellation before the (potentially from-scratch parse) work in
    // getTopLevelRegionsFor.
    if (token.isCancellationRequested) {
      return [];
    }
    const topLevelRegions = this.getTopLevelRegionsFor(document);
    return collectFoldingRanges(topLevelRegions);
  }

  private getTopLevelRegionsFor(document: vscode.TextDocument): readonly Region[] {
    const activeDocument = vscode.window.activeTextEditor?.document;
    // Serve the RegionStore cache whenever it holds this same document (URI
    // match), even if the store's version lags the editor mid edit-burst. The
    // scheme-agnostic, version-lenient gate avoids the second from-scratch parse;
    // onDidChangeFoldingRanges drives convergence once the store reparses.
    if (document === activeDocument && this.regionStore.documentId === getDocumentId(document)) {
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
