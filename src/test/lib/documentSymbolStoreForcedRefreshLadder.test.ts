import * as assert from "assert";
import * as vscode from "vscode";
import { DocumentSymbolStore } from "../../state/DocumentSymbolStore";
import { openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Regression test for plan 2.6: the Refresh button's forced symbol path
 * silently no-ops while a language server is warming up.
 *
 * The normal refresh path retries symbol fetches via a stepped-backoff ladder
 * when `executeDocumentSymbolProvider` returns `undefined` (no provider ready
 * yet). The forced path (`forceRefresh` → `refreshDocumentSymbolsForced`) used
 * to just `return` on `undefined`, so a forced refresh during warmup left the
 * outline empty until an unrelated edit re-triggered the normal path.
 *
 * A Stata `.do` file has grammar but no built-in document-symbol provider, so
 * the first fetch returns `undefined`. We register a provider *after* the forced
 * attempt-0 fetch has been dispatched (but before the ladder's first retry), so
 * only the retry ladder can surface the symbols.
 */
suite("DocumentSymbolStore forced-refresh retry ladder (plan 2.6)", function () {
  this.timeout(15000);

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("forceRefresh retries the ladder when the provider warms up after the first attempt", async () => {
    const doc = await openSampleDocument("validSamples", "validSample.do");
    const editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => vscode.window.activeTextEditor === editor, 3000, 25);
    assert.strictEqual(doc.languageId, "stata", "test env should recognize .do as Stata");

    const subscriptions: vscode.Disposable[] = [];
    const store = new DocumentSymbolStore(subscriptions);
    // forceRefresh() cancels the constructor's debounced *normal* refresh and
    // bumps the generation (killing any in-flight normal ladder), then runs the
    // forced fetch — which returns undefined here (no Stata symbol provider).
    // The forced retry ladder is therefore the only path that can populate
    // symbols from this point on.
    store.forceRefresh();

    let providerRegistration: vscode.Disposable | undefined;
    try {
      // Register the provider after the forced attempt-0 fetch was dispatched,
      // but before the ladder's first retry (~300ms).
      await delay(60);
      providerRegistration = vscode.languages.registerDocumentSymbolProvider(
        { language: "stata" },
        {
          provideDocumentSymbols(): vscode.DocumentSymbol[] {
            return [
              new vscode.DocumentSymbol(
                "WarmedUpSymbol",
                "",
                vscode.SymbolKind.Function,
                new vscode.Range(0, 0, 0, 1),
                new vscode.Range(0, 0, 0, 1)
              ),
            ];
          },
        }
      );

      await waitForCondition(() => store.flattenedDocumentSymbols.length > 0, 4000, 50).catch(
        () => undefined
      );

      assert.ok(
        store.flattenedDocumentSymbols.length > 0,
        "forceRefresh should retry the symbol ladder and pick up a provider that registers after the first attempt"
      );
    } finally {
      providerRegistration?.dispose();
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });
});
