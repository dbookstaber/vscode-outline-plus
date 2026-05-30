import * as assert from "assert";
import * as vscode from "vscode";
import { RegionFoldingProvider } from "../../lib/RegionFoldingProvider";
import { getVersionedDocumentId } from "../../lib/getVersionedDocumentId";
import { type Region } from "../../models/Region";
import { type RegionStore } from "../../state/RegionStore";

/**
 * Tests for CODE_REVIEW_MAY #5 — `RegionFoldingProvider` reuses the cached
 * parse from `RegionStore` for the active document instead of re-parsing on
 * every invocation.
 *
 * Strategy: construct a minimal `RegionStore`-shaped stub that returns a
 * sentinel region not derivable from the source. If the provider's output
 * contains the sentinel range, we know the cached path was used. The fallback
 * path (parsing) on the same source would return zero ranges because the
 * document has no region markers.
 */
suite("RegionFoldingProvider caching (CODE_REVIEW_MAY #5)", function () {
  this.timeout(10000);

  function makeStubRegionStore(
    versionedDocumentId: string | undefined,
    topLevelRegions: Region[]
  ): RegionStore {
    // We only need versionedDocumentId + topLevelRegions on the read path.
    // Other properties are not accessed by RegionFoldingProvider.
    return {
      get versionedDocumentId() {
        return versionedDocumentId;
      },
      get topLevelRegions() {
        return topLevelRegions;
      },
    } as unknown as RegionStore;
  }

  test("uses cached topLevelRegions when document is active and versions match", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\nline 1\nline 2\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    // Build a sentinel region the source text could never produce (plaintext
    // has no region markers configured).
    const sentinel: Region = {
      id: "sentinel-1",
      name: "sentinel",
      range: new vscode.Range(0, 0, 2, 5),
      regionIdx: 0,
      wasClosed: true,
      children: [],
    };

    const stubStore = makeStubRegionStore(
      getVersionedDocumentId(doc),
      [sentinel]
    );
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(ranges.length, 1,
      "Cached path should return the sentinel range from the stub store");
    const range = ranges[0];
    assert.ok(range);
    assert.strictEqual(range.start, 0);
    assert.strictEqual(range.end, 2);
  });

  test("falls back to parseAllRegions when document is not the active document", async () => {
    // Build two documents. We'll make one active and ask the provider to fold
    // the OTHER one. Even if the stub has a sentinel, the provider must NOT
    // use it because the document does not match the active editor.
    const activeDoc = await vscode.workspace.openTextDocument({
      content: "active document\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(activeDoc);

    const inactiveDoc = await vscode.workspace.openTextDocument({
      content: "inactive document\n",
      language: "plaintext",
    });

    const sentinel: Region = {
      id: "sentinel-2",
      name: "sentinel",
      range: new vscode.Range(0, 0, 0, 0),
      regionIdx: 0,
      wasClosed: true,
      children: [],
    };

    // The stub claims to know the inactive doc's version, but the provider
    // should detect the active-document mismatch and fall back to parsing.
    const stubStore = makeStubRegionStore(
      getVersionedDocumentId(inactiveDoc),
      [sentinel]
    );
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      inactiveDoc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    // plaintext has no region patterns → parseAllRegions returns zero ranges.
    assert.strictEqual(ranges.length, 0,
      "Fallback path on plaintext with no markers should yield zero ranges (NOT the sentinel)");
  });

  test("falls back to parseAllRegions when versioned IDs mismatch", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    const sentinel: Region = {
      id: "sentinel-3",
      name: "sentinel",
      range: new vscode.Range(0, 0, 0, 0),
      regionIdx: 0,
      wasClosed: true,
      children: [],
    };

    // Stub reports a stale versioned ID. Provider must NOT trust the cache.
    const stubStore = makeStubRegionStore(
      "stale-document-id@-1",
      [sentinel]
    );
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(ranges.length, 0,
      "Mismatched versionedDocumentId should fall back to parseAllRegions");
  });
});
