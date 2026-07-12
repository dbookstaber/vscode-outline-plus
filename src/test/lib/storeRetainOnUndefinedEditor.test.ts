import * as assert from "assert";
import * as vscode from "vscode";
import { DEBOUNCE_DOCUMENT_PARSE_MS } from "../../constants";
import { DocumentSymbolStore } from "../../state/DocumentSymbolStore";
import { RegionStore } from "../../state/RegionStore";
import { openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Regression tests for plan 4.7a: when `activeTextEditor` becomes `undefined`
 * (a transient focus loss — focusing a webview/Output panel, or a tab switch in
 * progress), the stores used to CLEAR their state and fire, so the Full Outline
 * flashed empty and reparsed/refetched on the round trip back. The stores must
 * instead RETAIN last-known state until a *different real editor* takes focus.
 */
suite("Stores retain state when activeTextEditor becomes undefined (plan 4.7a)", function () {
  this.timeout(20000);

  const SETTLE_MS = DEBOUNCE_DOCUMENT_PARSE_MS + 250;

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("DocumentSymbolStore retains symbols after the active editor becomes undefined", async () => {
    // Register a provider so symbol population is deterministic (no dependence
    // on a language server's warm-up).
    const providerRegistration = vscode.languages.registerDocumentSymbolProvider(
      { language: "stata" },
      {
        provideDocumentSymbols(): vscode.DocumentSymbol[] {
          return [
            new vscode.DocumentSymbol(
              "RetainedSymbol",
              "",
              vscode.SymbolKind.Function,
              new vscode.Range(0, 0, 0, 1),
              new vscode.Range(0, 0, 0, 1)
            ),
          ];
        },
      }
    );

    const doc = await openSampleDocument("validSamples", "validSample.do");
    const editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => vscode.window.activeTextEditor === editor, 3000, 25);

    const subscriptions: vscode.Disposable[] = [];
    const store = new DocumentSymbolStore(subscriptions);

    try {
      await waitForCondition(
        () => store.flattenedDocumentSymbols.some((s) => s.name === "RetainedSymbol"),
        6000,
        50
      );
      const symbolCountBefore = store.flattenedDocumentSymbols.length;
      assert.ok(symbolCountBefore > 0, "sanity: symbols should be populated before focus loss");

      // Drop the active editor entirely → activeTextEditor becomes undefined.
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await waitForCondition(() => vscode.window.activeTextEditor === undefined, 3000, 25);
      // Let the debounced refresh(undefined) run (and would-be clear happen).
      await delay(SETTLE_MS);

      assert.strictEqual(
        store.flattenedDocumentSymbols.length,
        symbolCountBefore,
        "symbols must be retained (not cleared) when the active editor becomes undefined"
      );
      assert.ok(
        store.flattenedDocumentSymbols.some((s) => s.name === "RetainedSymbol"),
        "the retained symbols must be the same last-known symbols"
      );
    } finally {
      providerRegistration.dispose();
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });

  test("RegionStore retains regions after the active editor becomes undefined", async () => {
    const doc = await openSampleDocument("sampleRegionsDocument.ts");
    const editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => vscode.window.activeTextEditor === editor, 3000, 25);

    const subscriptions: vscode.Disposable[] = [];
    const store = new RegionStore(subscriptions);

    try {
      await waitForCondition(() => store.topLevelRegions.length > 0, 4000, 50);
      const regionNamesBefore = store.topLevelRegions.map((r) => r.name);
      assert.ok(regionNamesBefore.length > 0, "sanity: regions should be populated before focus loss");

      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
      await waitForCondition(() => vscode.window.activeTextEditor === undefined, 3000, 25);
      await delay(SETTLE_MS);

      assert.deepStrictEqual(
        store.topLevelRegions.map((r) => r.name),
        regionNamesBefore,
        "regions must be retained (not cleared) when the active editor becomes undefined"
      );
    } finally {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });
});
