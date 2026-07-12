import * as vscode from "vscode";
import { DEBOUNCE_DOCUMENT_PARSE_MS } from "../constants";
import { isIgnoredDocumentScheme } from "../lib/documentScheme";
import { fetchDocumentSymbols, fetchDocumentSymbolsAfterDelay } from "../lib/fetchDocumentSymbols";
import { flattenDocumentSymbols } from "../lib/flattenDocumentSymbols";
import { extractDocumentIdFromVersioned, getVersionedDocumentId } from "../lib/getVersionedDocumentId";
import { type DebouncedFunction, debounce } from "../utils/debounce";
import { log } from "../utils/debugLog";

/**
 * Maximum number of retry attempts for fetching document symbols.
 * Using 10 attempts with stepped delays allows for a total max wait of ~30 seconds.
 */
const MAX_NUM_DOCUMENT_SYMBOLS_FETCH_ATTEMPTS = 10;

/**
 * Stepped backoff delays for document symbol fetch retries.
 * User preference: stepped (linear) rather than exponential.
 * Reasoning: Exponential grows too quickly and is less predictable for debugging.
 *
 * Pattern:
 * - First 3 retries: 300ms (quick retries for fast language servers)
 * - Next 3 retries: 1000ms (medium pace for moderate startup)
 * - Next 2 retries: 3000ms (slower pace for heavy projects)
 * - Final 2 retries: 5000ms (patience for very slow language servers)
 *
 * Total max wait: ~30 seconds (if all retries are used)
 * - 3 × 300ms = 900ms
 * - 3 × 1000ms = 3000ms
 * - 2 × 3000ms = 6000ms
 * - 2 × 5000ms = 10000ms
 * Total: ~20 seconds for delays + parsing time ≈ 30 seconds
 */
function getRetryDelayMs(attemptIdx: number): number {
  // attemptIdx is 0-based, but on first attempt (0) we don't wait
  // So attemptIdx 1 is the first retry
  if (attemptIdx <= 3) {
    // First 3 retries: quick (300ms)
    return 300;
  } else if (attemptIdx <= 6) {
    // Next 3 retries: medium (1000ms)
    return 1000;
  } else if (attemptIdx <= 8) {
    // Next 2 retries: slower (3000ms)
    return 3000;
  } else {
    // Final retries: patience (5000ms)
    return 5000;
  }
}

export class DocumentSymbolStore implements vscode.Disposable {
  private _documentSymbols: vscode.DocumentSymbol[] = [];
  private _flattenedDocumentSymbols: vscode.DocumentSymbol[] = [];
  private _onDidChangeDocumentSymbols = new vscode.EventEmitter<void>();
  readonly onDidChangeDocumentSymbols = this._onDidChangeDocumentSymbols.event;
  get documentSymbols(): vscode.DocumentSymbol[] {
    return this._documentSymbols;
  }
  get flattenedDocumentSymbols(): vscode.DocumentSymbol[] {
    return this._flattenedDocumentSymbols;
  }

  private _versionedDocumentId: string | undefined = undefined;
  get versionedDocumentId(): string | undefined {
    return this._versionedDocumentId;
  }

  /**
   * Monotonically increasing counter to detect stale async fetches.
   * Each call to refreshDocumentSymbols increments this; if the value has
   * changed by the time an async fetch completes, the result is discarded.
   */
  private _refreshGeneration = 0;

  /**
   * Tracks retry ladders that have already run to exhaustion (all
   * {@link MAX_NUM_DOCUMENT_SYMBOLS_FETCH_ATTEMPTS} attempts returned
   * `undefined`) per document, keyed by URI → the `languageId` that exhausted
   * (plan 4.4).
   *
   * Without this, a provider-less file-scheme document (.txt/.log/.csv, a
   * language with no symbol provider) re-spawns the full ~10-attempt / ~20 s
   * ladder on *every* 250 ms edit-pause — ~10 pointless cross-host
   * `executeDocumentSymbolProvider` queries per pause, with overlapping chains.
   * Once a ladder exhausts we do a single probe per subsequent refresh instead.
   *
   * Reset (a fresh full ladder is allowed again) when:
   *  - the document's `languageId` changes (its provider set may now differ),
   *  - the user forces a refresh (Refresh button), or
   *  - a probe finally returns symbols (a provider registered).
   *
   * VS Code fires no "provider registered" event, so these cheap heuristics
   * stand in for one.
   */
  private _exhaustedSymbolLadders = new Map<string, string>();

  private debouncedRefreshDocumentSymbols: DebouncedFunction<
    (document: vscode.TextDocument | undefined) => void
  > = debounce(this.refreshDocumentSymbols.bind(this), DEBOUNCE_DOCUMENT_PARSE_MS);

  /**
   * Maps a retry attempt index to its backoff delay. Defaults to the production
   * stepped ladder ({@link getRetryDelayMs}); overridable via the constructor so
   * tests can exercise the full ladder without waiting the real ~15 s.
   */
  private readonly retryDelayMsForAttempt: (attemptIdx: number) => number;

  /**
   * Symbol-fetch functions, defaulting to the real ones (each dispatches exactly
   * one `vscode.executeDocumentSymbolProvider`). Injectable so a test can count
   * *this store's* provider dispatches precisely, unpolluted by the always-on
   * extension singleton's own store (plan 4.4 mechanism test).
   */
  private readonly _fetchDocumentSymbols: typeof fetchDocumentSymbols;
  private readonly _fetchDocumentSymbolsAfterDelay: typeof fetchDocumentSymbolsAfterDelay;

  constructor(
    subscriptions: vscode.Disposable[],
    options?: {
      retryDelayMsForAttempt?: (attemptIdx: number) => number;
      fetchDocumentSymbols?: typeof fetchDocumentSymbols;
      fetchDocumentSymbolsAfterDelay?: typeof fetchDocumentSymbolsAfterDelay;
    }
  ) {
    this.retryDelayMsForAttempt = options?.retryDelayMsForAttempt ?? getRetryDelayMs;
    this._fetchDocumentSymbols = options?.fetchDocumentSymbols ?? fetchDocumentSymbols;
    this._fetchDocumentSymbolsAfterDelay =
      options?.fetchDocumentSymbolsAfterDelay ?? fetchDocumentSymbolsAfterDelay;
    this.registerListeners(subscriptions);
    if (vscode.window.activeTextEditor?.document) {
      this.debouncedRefreshDocumentSymbols(vscode.window.activeTextEditor.document);
    }
  }

  dispose(): void {
    this.debouncedRefreshDocumentSymbols.cancel();
    this._onDidChangeDocumentSymbols.dispose();
  }

  /**
   * Forces an immediate refresh of document symbols for the active editor,
   * bypassing change-detection so the event always fires.
   */
  forceRefresh(): void {
    const document = vscode.window.activeTextEditor?.document;
    // Plan 4.4: an explicit Refresh is the user asking us to try again, so drop
    // any recorded ladder-exhaustion for this document and let the forced path
    // run a full ladder from scratch.
    if (document) {
      this._exhaustedSymbolLadders.delete(document.uri.toString());
    }
    this.debouncedRefreshDocumentSymbols.cancel();
    void this.refreshDocumentSymbolsForced(document);
  }

  private async refreshDocumentSymbolsForced(
    document: vscode.TextDocument | undefined
  ): Promise<void> {
    const generation = ++this._refreshGeneration;
    if (!document) {
      this._versionedDocumentId = undefined;
      this._documentSymbols = [];
      this._flattenedDocumentSymbols = [];
      this._onDidChangeDocumentSymbols.fire();
      return;
    }
    // Plan 4.7b: never treat an ignored-scheme document (e.g. the Output panel)
    // as a source document — retain last-known symbols rather than clearing or
    // querying a provider that will never resolve.
    if (isIgnoredDocumentScheme(document)) {
      return;
    }
    // Eagerly advance versionedDocumentId on URI change so a missing/slow
    // symbol provider does not leave us stuck on the previous file.
    // (Same rationale as the equivalent block in refreshDocumentSymbols.)
    const newDocId = document.uri.toString();
    const oldDocId =
      this._versionedDocumentId !== undefined
        ? extractDocumentIdFromVersioned(this._versionedDocumentId)
        : undefined;
    if (oldDocId !== newDocId) {
      this._versionedDocumentId = getVersionedDocumentId(document);
      this._documentSymbols = [];
      this._flattenedDocumentSymbols = [];
      this._onDidChangeDocumentSymbols.fire();
    }
    try {
      const fetchResult = await this._fetchDocumentSymbols(document);
      if (generation !== this._refreshGeneration) {
        return;
      }
      const { documentSymbols, versionedDocumentId } = fetchResult;
      if (documentSymbols === undefined) {
        // Language server not ready yet (e.g. a forced refresh — the Refresh
        // button — fired while the server is still warming up). The normal
        // refresh path retries via the stepped-backoff ladder; the forced path
        // must too (plan 2.6), otherwise a forced refresh during warmup silently
        // no-ops and the outline stays empty until an unrelated edit. Fall into
        // the ladder at attempt 1, threading this refresh's generation so a
        // superseding refresh cancels the chain.
        void this.refreshDocumentSymbols(document, 1, generation);
        return;
      }
      sortSymbolsRecursivelyByStart(documentSymbols);
      this._versionedDocumentId = versionedDocumentId;
      this._documentSymbols = documentSymbols;
      this._flattenedDocumentSymbols = flattenDocumentSymbols(documentSymbols);
      // Always fire on force refresh, even if no change detected
      this._onDidChangeDocumentSymbols.fire();
    } catch (error: unknown) {
      log(`DocumentSymbolStore: error during forced symbol fetch: ${String(error)}`);
    }
  }

  private registerListeners(subscriptions: vscode.Disposable[]): void {
    vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        log(`DocumentSymbolStore: active editor changed → ${editor?.document.uri.toString() ?? "(none)"}`);
        this.debouncedRefreshDocumentSymbols(editor?.document);
      },
      undefined,
      subscriptions
    );
    vscode.workspace.onDidChangeTextDocument(
      (event) => {
        // Only refresh if the changed document is the active editor's document.
        // onDidChangeTextDocument fires for ALL open documents (e.g., background saves,
        // auto-formatters), and refreshing for non-active documents would overwrite
        // the store with incorrect data.
        if (event.document === vscode.window.activeTextEditor?.document) {
          this.debouncedRefreshDocumentSymbols(event.document);
        }
      },
      undefined,
      subscriptions
    );
  }

  private async refreshDocumentSymbols(
    document: vscode.TextDocument | undefined,
    attemptIdx = 0,
    originGeneration?: number
  ): Promise<void> {
    // Increment generation only on top-level calls; recursive retry calls
    // inherit the original generation so we can detect when a newer top-level
    // refresh has superseded this entire chain.
    const generation =
      attemptIdx === 0 ? ++this._refreshGeneration : (originGeneration ?? this._refreshGeneration);

    if (!document) {
      // Plan 4.7a: activeTextEditor becomes undefined on a *transient* focus
      // loss (focusing a webview/Output panel, a tab switch in progress), not
      // only when the last editor closes. Clearing + firing here made the Full
      // Outline flash empty and then refetch symbols on every editor↔webview
      // round trip (visible as tree flicker; "symbols changed" refetch at an
      // unchanged version). Retain last-known symbols instead — a switch to a
      // *different* real editor (document defined) still replaces them below.
      return;
    }

    // Plan 4.7b: ignored-scheme docs (e.g. the Output panel) are never source
    // documents; retain state rather than clearing or launching the retry
    // ladder against a document that can never gain a symbol provider.
    if (isIgnoredDocumentScheme(document)) {
      return;
    }

    // Eagerly clear stale state when the active document's URI changes.
    //
    // Why this is necessary: For languages without a symbol provider (e.g.
    // Stata `.do` files), `executeDocumentSymbolProvider` returns `undefined`
    // on every retry. Without this clear, `_versionedDocumentId` stays
    // pointing at the previously-viewed file forever, which traps
    // `FullOutlineStore` in its mismatch-retry branch — the symptom: opening
    // a Stata file leaves the Full Outline showing the prior file's items.
    //
    // We clear immediately at attempt 0 so consumers see "I'm now tracking
    // the new doc, with no symbols yet" instead of "I'm still on the old
    // doc". A subsequent successful fetch will replace the empty symbols
    // and fire another change event.
    if (attemptIdx === 0) {
      // Plan 4.4: if this URI's recorded ladder-exhaustion was earned under a
      // different languageId, the language changed and its provider set may now
      // differ — drop the record so a fresh full ladder is allowed.
      const exhaustedLang = this._exhaustedSymbolLadders.get(document.uri.toString());
      if (exhaustedLang !== undefined && exhaustedLang !== document.languageId) {
        this._exhaustedSymbolLadders.delete(document.uri.toString());
      }
      const newDocId = document.uri.toString();
      const oldDocId =
        this._versionedDocumentId !== undefined
          ? extractDocumentIdFromVersioned(this._versionedDocumentId)
          : undefined;
      if (oldDocId !== newDocId) {
        this._versionedDocumentId = getVersionedDocumentId(document);
        this._documentSymbols = [];
        this._flattenedDocumentSymbols = [];
        // Always fire — downstream stores (FullOutlineStore) need to
        // re-evaluate convergence now that `versionedDocumentId` has
        // advanced to the new URI, regardless of whether we had cached
        // symbols to discard.
        this._onDidChangeDocumentSymbols.fire();
      }
    }

    if (attemptIdx >= MAX_NUM_DOCUMENT_SYMBOLS_FETCH_ATTEMPTS) {
      // Plan 4.4: the whole ladder ran without ever resolving symbols. Record
      // exhaustion so subsequent refreshes probe once instead of re-spawning
      // the full ~20 s chain on every edit-pause.
      this._exhaustedSymbolLadders.set(document.uri.toString(), document.languageId);
      return;
    }
    // Before sleeping for a retry, bail out if a newer top-level refresh has
    // been initiated. Without this, the retry chain wastes up to ~5 seconds
    // (the longest stepped delay) sleeping before noticing it's stale.
    // Requires `originGeneration` threading above — otherwise `generation`
    // would just be a fresh re-read of `_refreshGeneration` and the check
    // would be trivially false.
    if (attemptIdx > 0 && generation !== this._refreshGeneration) {
      log(`DocumentSymbolStore: aborting retry chain before delay (gen ${generation} vs current ${this._refreshGeneration})`);
      return;
    }
    try {
      const retryDelayMs = this.retryDelayMsForAttempt(attemptIdx);
      const fetchResult =
        attemptIdx === 0
          ? await this._fetchDocumentSymbols(document)
          : await this._fetchDocumentSymbolsAfterDelay(document, retryDelayMs);

      // Discard result if a newer refresh was initiated while we were fetching.
      // This prevents a slow fetch for editor A from overwriting results after
      // the user has already switched to editor B.
      if (generation !== this._refreshGeneration) {
        log(`DocumentSymbolStore: discarding stale fetch (gen ${generation} vs current ${this._refreshGeneration})`);
        return;
      }

      // If the document became inactive during a delayed retry, fetchResult will be undefined
      if (!fetchResult) {
        return;
      }
      const { documentSymbols, versionedDocumentId } = fetchResult;
      if (documentSymbols === undefined) {
        // Plan 4.4: if a full ladder already exhausted for this URI+language,
        // this attempt-0 fetch was the single allowed probe per refresh — do
        // NOT re-spawn the ~20 s chain. (The record is cleared on a language
        // change, a forced refresh, or a successful fetch, so a genuinely
        // slow-but-present provider is not permanently starved.)
        if (
          attemptIdx === 0 &&
          this._exhaustedSymbolLadders.get(document.uri.toString()) === document.languageId
        ) {
          return;
        }
        // Language server not ready yet - schedule next retry with stepped backoff.
        // Thread the original generation so the next retry's pre-await check
        // can detect a superseding top-level refresh.
        void this.refreshDocumentSymbols(document, attemptIdx + 1, generation);
        return;
      }
      // Plan 4.4: a provider resolved — clear any recorded exhaustion so we keep
      // serving it, and a future provider loss re-earns a fresh full ladder.
      this._exhaustedSymbolLadders.delete(document.uri.toString());

      // Short-circuit: if we already have symbols stored for this exact
      // versioned id, the new fetch is guaranteed identical. Skip the
      // deep-equality walk + replacement. We must still allow the path
      // through when `_documentSymbols` is empty (the URI-change branch
      // above eagerly advances `_versionedDocumentId` before symbols
      // arrive — without this guard the first real fetch would be dropped).
      if (this._versionedDocumentId === versionedDocumentId && this._documentSymbols.length > 0) {
        return;
      }
      // Plan 4.6a: sort only once we've committed to keeping these symbols. The
      // recursive sort previously ran *above* the short-circuit, so every
      // identical-version refresh (each edit-pause on an unchanged doc) paid for
      // a full recursive sort whose result was then immediately discarded.
      sortSymbolsRecursivelyByStart(documentSymbols); // executeDocumentSymbolProvider returns symbols ordered by name

      const oldDocumentSymbols = this._documentSymbols;
      this._versionedDocumentId = versionedDocumentId;
      this._documentSymbols = documentSymbols;
      this._flattenedDocumentSymbols = flattenDocumentSymbols(documentSymbols);

      // Only fire event if the symbols actually changed
      if (didDocumentSymbolsChange(oldDocumentSymbols, documentSymbols)) {
        log(`DocumentSymbolStore: symbols changed (${documentSymbols.length} symbols, ${versionedDocumentId})`);
        this._onDidChangeDocumentSymbols.fire();
      }
    } catch (error: unknown) {
      log(`DocumentSymbolStore: error fetching symbols (attempt ${attemptIdx}): ${String(error)}`);
    }
  }
}

function sortSymbolsRecursivelyByStart(symbols: vscode.DocumentSymbol[]): void {
  symbols.sort((symbol1, symbol2) => symbol1.range.start.compareTo(symbol2.range.start));
  for (const symbol of symbols) {
    sortSymbolsRecursivelyByStart(symbol.children);
  }
}

// #region Change detection helpers

function didDocumentSymbolsChange(
  oldDocumentSymbols: vscode.DocumentSymbol[],
  newDocumentSymbols: vscode.DocumentSymbol[]
): boolean {
  if (oldDocumentSymbols.length !== newDocumentSymbols.length) {
    return true;
  }
  for (let i = 0; i < oldDocumentSymbols.length; i++) {
    const oldDocumentSymbol = oldDocumentSymbols[i];
    const newDocumentSymbol = newDocumentSymbols[i];
    if (
      oldDocumentSymbol &&
      newDocumentSymbol &&
      !areDocumentSymbolsEqual(oldDocumentSymbol, newDocumentSymbol)
    ) {
      return true;
    }
  }
  return false;
}

function areDocumentSymbolsEqual(
  symbol1: vscode.DocumentSymbol,
  symbol2: vscode.DocumentSymbol
): boolean {
  return (
    symbol1.name === symbol2.name &&
    symbol1.kind === symbol2.kind &&
    symbol1.range.isEqual(symbol2.range) &&
    symbol1.selectionRange.isEqual(symbol2.selectionRange) &&
    !didDocumentSymbolsChange(symbol1.children, symbol2.children)
  );
}

// #endregion
