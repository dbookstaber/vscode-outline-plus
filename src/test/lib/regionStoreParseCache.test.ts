import * as assert from "assert";
import * as vscode from "vscode";
import { RegionStore } from "../../state/RegionStore";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Regression test for plan 4.6b: a per-URI+version LRU parse cache so an
 * A→B→A tab switch does not reparse A. The version short-circuit alone doesn't
 * cover this — after switching to B, the store's versioned id points at B, so
 * returning to A (unchanged) would otherwise trigger a fresh parse.
 *
 * Mechanism check (not wall-clock): `parseAllRegions` returns fresh Region
 * objects on every call, so if returning to A yields the *same* Region object
 * references as the first visit, the result came from the cache rather than a
 * reparse. Pre-cache, these references would differ.
 */
suite("RegionStore A→B→A parse cache (plan 4.6b)", function () {
  this.timeout(20000);

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("returning to a previously-parsed document reuses the cached parse (no reparse)", async () => {
    const docA = await openSampleDocument("sampleRegionsDocument.ts");
    const docB = await openSampleDocument("validSamples", "validSample.do");

    const subscriptions: vscode.Disposable[] = [];
    const store = new RegionStore(subscriptions);

    const hasRegion = (name: string): boolean =>
      store.topLevelRegions.some((r) => r.name === name);

    try {
      // Visit A.
      await vscode.window.showTextDocument(docA);
      await waitForCondition(() => hasRegion("Imports"), 5000, 50);
      const firstVisitRegions = store.topLevelRegions;
      const firstVisitFirstRegion = firstVisitRegions[0];
      assert.ok(firstVisitFirstRegion !== undefined, "sanity: A should have top-level regions");

      // Visit B (a different document with different regions).
      await vscode.window.showTextDocument(docB);
      await waitForCondition(() => hasRegion("FirstRegion") && !hasRegion("Imports"), 5000, 50);
      assert.notStrictEqual(
        store.topLevelRegions,
        firstVisitRegions,
        "sanity: switching to B must replace A's regions"
      );

      // Return to A. No edits were made, so the URI+version key is unchanged.
      await vscode.window.showTextDocument(docA);
      await waitForCondition(() => hasRegion("Imports"), 5000, 50);

      assert.strictEqual(
        store.topLevelRegions,
        firstVisitRegions,
        "returning to A must reuse the cached parse array (same reference), not reparse"
      );
      assert.strictEqual(
        store.topLevelRegions[0],
        firstVisitFirstRegion,
        "the cached Region objects must be the identical instances from the first visit"
      );
    } finally {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });

  test("forceRefresh clears cached parses for non-active documents (pattern-config change invalidates the whole cache)", async () => {
    // A region-boundary-pattern config change reparses EVERY document under new
    // rules at the same uri@version. forceRefresh is the nuclear option wired to
    // that change; if it did not evict the cache, an A→B→A switch after the
    // change would serve A's pre-change parse from the stale entry.
    //
    // We prove whole-cache clearing via a document that is NOT active at
    // forceRefresh time (A, after switching to B): forceRefresh may re-seed the
    // ACTIVE doc's fresh parse, but every other document's entry must be gone.
    const docA = await openSampleDocument("sampleRegionsDocument.ts");
    const docB = await openSampleDocument("validSamples", "validSample.do");

    const subscriptions: vscode.Disposable[] = [];
    const store = new RegionStore(subscriptions);
    // Test-only reach into the private cache (mirrors the close-eviction test).
    const parseCache = (store as unknown as { _parseCache: Map<string, unknown> })._parseCache;
    const docAId = docA.uri.toString();
    const hasCacheEntryForDocA = (): boolean =>
      [...parseCache.keys()].some((key) => key.startsWith(`${docAId}@`));

    const hasRegion = (name: string): boolean =>
      store.topLevelRegions.some((r) => r.name === name);

    try {
      // Populate the cache for A.
      await vscode.window.showTextDocument(docA);
      await waitForCondition(() => hasRegion("Imports"), 5000, 50);
      assert.ok(hasCacheEntryForDocA(), "sanity: A's parse must be cached while it is active");

      // Switch to B so A is now cached-but-not-active.
      await vscode.window.showTextDocument(docB);
      await waitForCondition(() => hasRegion("FirstRegion") && !hasRegion("Imports"), 5000, 50);
      assert.ok(hasCacheEntryForDocA(), "sanity: A must stay cached after switching to B");

      // Simulate the pattern-config change path.
      store.forceRefresh();

      assert.ok(
        !hasCacheEntryForDocA(),
        "forceRefresh must evict A's (non-active) cached parse so a later A→B→A switch reparses under the new rules"
      );
    } finally {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });

  test("closing a document evicts its cached parses (version counter may reset on reopen)", async () => {
    // VS Code resets a document's version counter when it is closed and later
    // reopened, so a stale `uri@version` entry could otherwise collide with
    // different content after an external edit made while the file was closed.
    // Uses an untitled document because closing its editor disposes the
    // document and fires `onDidCloseTextDocument` promptly (file-backed docs
    // are kept cached by VS Code for a while).
    const doc = await vscode.workspace.openTextDocument({
      content: "// #region Cached\nconst x = 1;\n// #endregion\n",
      language: "typescript",
    });

    const subscriptions: vscode.Disposable[] = [];
    const store = new RegionStore(subscriptions);
    // Test-only reach into the private cache: eviction has no other observable
    // surface without reproducing the close→external-edit→reopen version reset.
    const parseCache = (store as unknown as { _parseCache: Map<string, unknown> })._parseCache;
    const docId = doc.uri.toString();
    const hasCacheEntryForDoc = (): boolean =>
      [...parseCache.keys()].some((key) => key.startsWith(`${docId}@`));

    try {
      await vscode.window.showTextDocument(doc);
      await waitForCondition(
        () => store.topLevelRegions.some((r) => r.name === "Cached"),
        5000,
        50
      );
      assert.ok(hasCacheEntryForDoc(), "sanity: the parse must be cached while the doc is open");

      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
      await waitForCondition(() => !hasCacheEntryForDoc(), 5000, 50);
      assert.ok(!hasCacheEntryForDoc(), "closing the document must evict its cached parses");
    } finally {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });
});
