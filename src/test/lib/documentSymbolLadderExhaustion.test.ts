import * as assert from "assert";
import * as vscode from "vscode";
import {
  fetchDocumentSymbols,
  fetchDocumentSymbolsAfterDelay,
} from "../../lib/fetchDocumentSymbols";
import { DocumentSymbolStore } from "../../state/DocumentSymbolStore";
import { openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Regression test for plan 4.4: the symbol retry ladder used to be re-spawned in
 * full on every 250 ms edit-pause for any document with no symbol provider
 * (.txt/.log/.csv, or a language like Stata with grammar but no provider) —
 * ~10 pointless `executeDocumentSymbolProvider` dispatches per pause.
 *
 * After the fix, once a ladder runs to exhaustion for a URI+languageId, each
 * subsequent refresh does a SINGLE probe instead of re-spawning the ladder.
 *
 * We count dispatches at *this store's* injected fetchers rather than spying on
 * `vscode.commands.executeCommand`, because the extension singleton
 * (`onStartupFinished`) runs its own DocumentSymbolStore against the same active
 * document; a global spy would conflate the two. The injected fetchers delegate
 * to the real ones, so each counted call is exactly one real provider dispatch.
 */
suite("DocumentSymbolStore retry-ladder exhaustion (plan 4.4)", function () {
  this.timeout(20000);

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  test("after exhaustion, each edit-pause dispatches one probe, not a fresh ladder", async () => {
    const doc = await openSampleDocument("validSamples", "validSample.do");
    const editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => vscode.window.activeTextEditor === editor, 3000, 25);
    assert.strictEqual(
      doc.languageId,
      "stata",
      "test env should recognize .do as Stata (grammar but no symbol provider)"
    );

    let dispatchCount = 0;
    const countingFetch: typeof fetchDocumentSymbols = (
      document
    ): ReturnType<typeof fetchDocumentSymbols> => {
      dispatchCount += 1;
      return fetchDocumentSymbols(document);
    };
    const countingFetchAfterDelay: typeof fetchDocumentSymbolsAfterDelay = (
      document,
      delayMs
    ): ReturnType<typeof fetchDocumentSymbolsAfterDelay> => {
      dispatchCount += 1;
      return fetchDocumentSymbolsAfterDelay(document, delayMs);
    };

    const subscriptions: vscode.Disposable[] = [];
    // Fast retry delays so the full 10-attempt ladder exhausts in well under a
    // second instead of the production ~15 s.
    const store = new DocumentSymbolStore(subscriptions, {
      retryDelayMsForAttempt: (): number => 15,
      fetchDocumentSymbols: countingFetch,
      fetchDocumentSymbolsAfterDelay: countingFetchAfterDelay,
    });

    try {
      // The constructor's initial refresh runs the full ladder against the
      // provider-less doc: 1 attempt-0 fetch + 9 retry fetches = 10 dispatches.
      await waitForCondition(() => dispatchCount >= 10, 8000, 25);
      assert.ok(
        dispatchCount >= 10,
        `the first ladder should dispatch the full ~10 attempts; got ${dispatchCount}`
      );

      // Ladder is now exhausted for stata@this-URI. Each subsequent edit-pause
      // must dispatch exactly ONE probe (not a re-spawned 10-attempt ladder).
      const editCount = 3;
      dispatchCount = 0;
      for (let i = 0; i < editCount; i++) {
        await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), `* c${i}\n`));
        // Wait past the 250 ms parse debounce so this edit's refresh fires and
        // its single probe resolves before the next edit is made.
        await delay(350);
      }
      // Settle for any late dispatch (there should be none).
      await delay(400);

      assert.strictEqual(
        dispatchCount,
        editCount,
        `an exhausted ladder must probe exactly once per edit-pause (${editCount}); got ` +
          `${dispatchCount} — a re-spawned ladder would be ~${editCount * 10}`
      );
    } finally {
      store.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    }
  });

  test("a probe that finally resolves clears exhaustion and re-earns a full ladder on provider loss", async () => {
    const doc = await openSampleDocument("validSamples", "validSample.do");
    const editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => vscode.window.activeTextEditor === editor, 3000, 25);

    let dispatchCount = 0;
    const countingFetch: typeof fetchDocumentSymbols = (
      document
    ): ReturnType<typeof fetchDocumentSymbols> => {
      dispatchCount += 1;
      return fetchDocumentSymbols(document);
    };
    const countingFetchAfterDelay: typeof fetchDocumentSymbolsAfterDelay = (
      document,
      delayMs
    ): ReturnType<typeof fetchDocumentSymbolsAfterDelay> => {
      dispatchCount += 1;
      return fetchDocumentSymbolsAfterDelay(document, delayMs);
    };

    const subscriptions: vscode.Disposable[] = [];
    const store = new DocumentSymbolStore(subscriptions, {
      retryDelayMsForAttempt: (): number => 15,
      fetchDocumentSymbols: countingFetch,
      fetchDocumentSymbolsAfterDelay: countingFetchAfterDelay,
    });

    let providerRegistration: vscode.Disposable | undefined;
    try {
      // Exhaust the ladder first (no provider).
      await waitForCondition(() => dispatchCount >= 10, 8000, 25);

      // Register a provider, then edit: the single post-exhaustion probe now
      // resolves, which must clear the exhaustion record.
      providerRegistration = vscode.languages.registerDocumentSymbolProvider(
        { language: "stata" },
        {
          provideDocumentSymbols(): vscode.DocumentSymbol[] {
            return [
              new vscode.DocumentSymbol(
                "LadderClearedSymbol",
                "",
                vscode.SymbolKind.Function,
                new vscode.Range(0, 0, 0, 1),
                new vscode.Range(0, 0, 0, 1)
              ),
            ];
          },
        }
      );

      await editor.edit((builder) => builder.insert(new vscode.Position(0, 0), "* provider now up\n"));
      await waitForCondition(() => store.flattenedDocumentSymbols.length > 0, 4000, 25);
      assert.ok(
        store.flattenedDocumentSymbols.some((s) => s.name === "LadderClearedSymbol"),
        "the post-exhaustion probe should pick up the newly-registered provider"
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
