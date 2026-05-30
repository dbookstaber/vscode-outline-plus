import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlinePlusAPI } from "../../api/regionHelperAPI";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Regression tests for the "Full Outline stuck on previous file" bug that
 * manifests when switching to a document whose language has no registered
 * symbol provider (e.g. Stata `.do` files).
 *
 * The root cause was in `DocumentSymbolStore`: when
 * `executeDocumentSymbolProvider` returned `undefined`, the retry chain ran
 * 10 times and gave up without ever updating `_versionedDocumentId`. That
 * left the store pinned to whatever document had previously had a
 * successful symbol fetch, which trapped FullOutlineStore in its
 * mismatch-retry branch.
 *
 * These tests assert the contract DocumentSymbolStore now provides:
 * - After switching to a doc with no symbol provider, its
 *   `versionedDocumentId` reflects the NEW doc's URI.
 * - The `onDidChangeFullOutlineItems` event fires for the new doc.
 *
 * We exercise the public extension API rather than `DocumentSymbolStore`
 * directly so the test survives the singleton refactor on the roadmap.
 */
suite("DocumentSymbolStore: no-symbol-provider document switching", function () {
  this.timeout(15000);

  let outlinePlusAPI: OutlinePlusAPI;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!extension) {
      throw new Error("Outline++ extension not found!");
    }
    await extension.activate();
    outlinePlusAPI = extension.exports as OutlinePlusAPI;
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("opening a Stata `.do` file with prior TS context fires onDidChangeFullOutlineItems", async () => {
    // Prime the store with a TS file that has both regions and symbols.
    const tsDoc = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(tsDoc);
    await waitForCondition(
      () => outlinePlusAPI.getTopLevelFullOutlineItems().length > 0,
      5000,
      50
    );

    // Set up the event watcher BEFORE we switch.
    let eventFires = 0;
    const disposable = outlinePlusAPI.onDidChangeFullOutlineItems(() => {
      eventFires += 1;
    });

    try {
      const stataDoc = await openSampleDocument("validSamples", "validSample.do");
      assert.strictEqual(stataDoc.languageId, "stata", "test env should recognize .do as Stata");
      await vscode.window.showTextDocument(stataDoc);

      // Pre-fix, FullOutlineStore would mismatch-retry (max 3) then give up,
      // and `onDidChangeFullOutlineItems` would not fire because refreshItems
      // never ran. Post-fix the symbol store advances eagerly and the event
      // fires for the new (region-only) outline.
      await waitForCondition(() => eventFires >= 1, 6000, 100);
      assert.ok(eventFires >= 1, "Full outline event should fire after switching to a no-provider doc");
    } finally {
      disposable.dispose();
    }
  });

  test("the Stata file's regions appear in the outline within a few debounce cycles", async () => {
    // This is the user-visible repro: a no-provider file whose ONLY outline
    // contribution is region markers must still show those regions.
    const stataDoc = await openSampleDocument("validSamples", "validSample.do");
    await vscode.window.showTextDocument(stataDoc);

    await waitForCondition(
      () => {
        const items = outlinePlusAPI.getTopLevelFullOutlineItems();
        return items.some((i) => i.displayName === "FirstRegion");
      },
      6000,
      100
    );

    const items = outlinePlusAPI.getTopLevelFullOutlineItems();
    const names = items.map((i) => i.displayName);
    assert.ok(
      names.includes("FirstRegion"),
      `Outline should include 'FirstRegion'; got: ${JSON.stringify(names)}`
    );
  });
});
