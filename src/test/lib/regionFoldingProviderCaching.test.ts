import * as assert from "assert";
import * as vscode from "vscode";
import { RegionFoldingProvider } from "../../lib/RegionFoldingProvider";
import { getDocumentId } from "../../lib/getVersionedDocumentId";
import { type Region } from "../../models/Region";
import { type RegionStore } from "../../state/RegionStore";

/**
 * Tests for `RegionFoldingProvider`'s cache behavior.
 *
 * Strategy: construct a minimal `RegionStore`-shaped stub that returns a
 * sentinel region not derivable from the source. If the provider's output
 * contains the sentinel range, we know the cached path was used. The fallback
 * (parse) path on plaintext (no configured region markers) returns zero ranges,
 * so a sentinel in the output is unambiguous proof the parse path was NOT taken.
 *
 * Plan 4.1: the cache must be served whenever the store holds the *same
 * document* (URI match) even if its version lags the editor — during an edit
 * burst the folding re-request lands inside the parse-debounce window, so a
 * version-exact gate would force a second, undebounced from-scratch parse.
 */
suite("RegionFoldingProvider caching (plan 4.1)", function () {
  this.timeout(10000);

  type StubOptions = {
    documentId: string | undefined;
    topLevelRegions: Region[];
    onDidChangeRegions?: vscode.Event<void>;
  };

  function makeStubRegionStore(options: StubOptions): RegionStore {
    // Only documentId + topLevelRegions (+ optionally onDidChangeRegions) are
    // accessed by RegionFoldingProvider. A no-op event is supplied by default so
    // the constructor's subscription succeeds.
    const noopEmitter = new vscode.EventEmitter<void>();
    return {
      get documentId() {
        return options.documentId;
      },
      get topLevelRegions() {
        return options.topLevelRegions;
      },
      onDidChangeRegions: options.onDidChangeRegions ?? noopEmitter.event,
    } as unknown as RegionStore;
  }

  function makeSentinel(id: string): Region {
    return {
      id,
      name: "sentinel",
      range: new vscode.Range(0, 0, 2, 5),
      regionIdx: 0,
      wasClosed: true,
      children: [],
    };
  }

  test("serves cached topLevelRegions when the document is active and the URI matches", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\nline 1\nline 2\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    const stubStore = makeStubRegionStore({
      documentId: getDocumentId(doc),
      topLevelRegions: [makeSentinel("sentinel-1")],
    });
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(
      ranges.length,
      1,
      "Cached path should return the sentinel range from the stub store"
    );
    const cachedRange = ranges[0];
    assert.ok(cachedRange);
    assert.strictEqual(cachedRange.start, 0);
    assert.strictEqual(cachedRange.end, 2);
    provider.dispose();
  });

  test("edit-burst request (version lags, URI matches) serves cache without a second parse", async () => {
    // Regression for plan 4.1: pre-fix the gate required a *versioned* id match.
    // Mid edit-burst the store's version trails the editor, so the pre-fix gate
    // fell through to parseAllRegions (a second from-scratch parse) — which on
    // plaintext yields ZERO ranges, so the sentinel would be absent. Post-fix the
    // URI-only gate serves the cache, so the sentinel (unparseable from the
    // source text) is present. The sentinel's presence is airtight proof the
    // parse path was NOT taken.
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\nline 1\nline 2\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    // Same URI as the active doc, but the store never advertises a version at all
    // here — the provider must key purely on the document id (URI), independent
    // of version. (Equivalent to the store lagging the live version.)
    const stubStore = makeStubRegionStore({
      documentId: getDocumentId(doc),
      topLevelRegions: [makeSentinel("sentinel-burst")],
    });
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(
      ranges.length,
      1,
      "Version-lagging same-URI request must serve the cached sentinel, not re-parse"
    );
    const burstRange = ranges[0];
    assert.ok(burstRange);
    assert.strictEqual(burstRange.start, 0);
    assert.strictEqual(burstRange.end, 2);
    provider.dispose();
  });

  test("fires onDidChangeFoldingRanges when the store's regions change (convergence)", () => {
    // After serving briefly-stale ranges mid-burst, the provider must notify VS
    // Code once the store finishes its debounced reparse so folding converges.
    const regionsEmitter = new vscode.EventEmitter<void>();
    const stubStore = makeStubRegionStore({
      documentId: "doc-id",
      topLevelRegions: [],
      onDidChangeRegions: regionsEmitter.event,
    });
    const provider = new RegionFoldingProvider(stubStore);

    let fireCount = 0;
    const sub = provider.onDidChangeFoldingRanges(() => {
      fireCount++;
    });

    regionsEmitter.fire();
    regionsEmitter.fire();

    assert.strictEqual(
      fireCount,
      2,
      "onDidChangeFoldingRanges must fire once per store onDidChangeRegions"
    );

    sub.dispose();
    provider.dispose();
    regionsEmitter.dispose();
  });

  test("falls back to parseAllRegions when the document is not the active document", async () => {
    const activeDoc = await vscode.workspace.openTextDocument({
      content: "active document\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(activeDoc);

    const inactiveDoc = await vscode.workspace.openTextDocument({
      content: "inactive document\n",
      language: "plaintext",
    });

    // Even though the stub's documentId matches the inactive doc, the provider
    // must fall back to parsing because that doc is not the active editor (the
    // store only ever caches the active document).
    const stubStore = makeStubRegionStore({
      documentId: getDocumentId(inactiveDoc),
      topLevelRegions: [makeSentinel("sentinel-inactive")],
    });
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      inactiveDoc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(
      ranges.length,
      0,
      "Fallback path on plaintext with no markers should yield zero ranges (NOT the sentinel)"
    );
    provider.dispose();
  });

  test("falls back to parseAllRegions when the store holds a different document (URI mismatch)", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    // Store's documentId points at some other URI: cross-document reveal must not
    // leak the sentinel; the provider parses the requested (plaintext) doc → 0.
    const stubStore = makeStubRegionStore({
      documentId: "file:///some/other/document.ts",
      topLevelRegions: [makeSentinel("sentinel-other")],
    });
    const provider = new RegionFoldingProvider(stubStore);

    const ranges = provider.provideFoldingRanges(
      doc,
      {} as vscode.FoldingContext,
      new vscode.CancellationTokenSource().token
    );

    assert.strictEqual(
      ranges.length,
      0,
      "A store holding a different document's regions must not be served for this URI"
    );
    provider.dispose();
  });

  test("returns no ranges when cancellation is already requested", async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: "line 0\nline 1\nline 2\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(doc);

    const stubStore = makeStubRegionStore({
      documentId: getDocumentId(doc),
      topLevelRegions: [makeSentinel("sentinel-cancel")],
    });
    const provider = new RegionFoldingProvider(stubStore);

    const cts = new vscode.CancellationTokenSource();
    cts.cancel();
    const ranges = provider.provideFoldingRanges(doc, {} as vscode.FoldingContext, cts.token);

    assert.strictEqual(
      ranges.length,
      0,
      "A pre-cancelled token must short-circuit to zero ranges even when the cache holds regions"
    );
    provider.dispose();
  });
});
