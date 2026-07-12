import * as vscode from "vscode";
import { EXTENSION_DISPLAY_NAME } from "../constants";
import { getDocumentId, getVersionedDocumentId } from "../lib/getVersionedDocumentId";
import { type InvalidMarker } from "../lib/parseAllRegions";
import { type RegionStore } from "../state/RegionStore";
import { debounce } from "../utils/debounce";
import { throwNever } from "../utils/errorUtils";

const DEBOUNCE_DELAY_MS = 300;

/**
 * Snapshot of the region-store state captured at the moment the
 * `onDidChangeInvalidMarkers` event fires. Capturing the document identity
 * *together with* the markers (rather than re-reading `activeTextEditor` after
 * the debounce settles) is what keeps doc A's markers from landing on doc B's
 * URI when the user switches editors during the debounce window.
 */
type DiagnosticsSnapshot = {
  documentId: string;
  versionedDocumentId: string;
  invalidMarkers: InvalidMarker[];
};

export class RegionDiagnosticsManager {
  private _diagnostics = vscode.languages.createDiagnosticCollection(EXTENSION_DISPLAY_NAME);

  constructor(private regionStore: RegionStore, subscriptions: vscode.Disposable[]) {
    this.registerInvalidMarkersChangeListener(subscriptions);
    this.registerDocumentCloseListener(subscriptions);
  }

  private registerInvalidMarkersChangeListener(subscriptions: vscode.Disposable[]): void {
    const debouncedApply = debounce(this.applyDiagnostics.bind(this), DEBOUNCE_DELAY_MS);
    // Capture the snapshot synchronously when the event fires (schedule time),
    // then debounce only the *application* of that snapshot.
    this.regionStore.onDidChangeInvalidMarkers(
      () => debouncedApply(this.captureSnapshot()),
      undefined,
      subscriptions
    );
  }

  private registerDocumentCloseListener(subscriptions: vscode.Disposable[]): void {
    // Closed documents must have their diagnostics cleared; otherwise a stale
    // warning lingers forever on a URI that is no longer open.
    vscode.workspace.onDidCloseTextDocument(
      (document) => this._diagnostics.delete(document.uri),
      undefined,
      subscriptions
    );
  }

  private captureSnapshot(): DiagnosticsSnapshot | undefined {
    const { documentId, versionedDocumentId, invalidMarkers } = this.regionStore;
    if (documentId === undefined || versionedDocumentId === undefined) {
      return undefined;
    }
    return { documentId, versionedDocumentId, invalidMarkers };
  }

  private applyDiagnostics(snapshot: DiagnosticsSnapshot | undefined): void {
    if (!snapshot) {
      this.clearDiagnostics();
      return;
    }
    const document = findOpenDocument(snapshot.documentId);
    if (!document) {
      // The document was closed during the debounce window; the close listener
      // clears its diagnostics, so there is nothing to set.
      return;
    }
    // Bail on mismatch: the document has been edited since these markers were
    // computed, so their line numbers may be stale. A fresh parse will fire
    // `onDidChangeInvalidMarkers` again with up-to-date markers.
    if (getVersionedDocumentId(document) !== snapshot.versionedDocumentId) {
      return;
    }
    const diagnostics = snapshot.invalidMarkers.map((invalidMarker) =>
      createDiagnostic(invalidMarker, document)
    );
    this._diagnostics.set(document.uri, diagnostics);
  }

  private clearDiagnostics(): void {
    this._diagnostics.clear();
  }

  get diagnostics(): vscode.DiagnosticCollection {
    return this._diagnostics;
  }
}

function findOpenDocument(documentId: string): vscode.TextDocument | undefined {
  return vscode.workspace.textDocuments.find((document) => getDocumentId(document) === documentId);
}

export function createDiagnostic(
  invalidMarker: InvalidMarker,
  document: vscode.TextDocument
): vscode.Diagnostic {
  const { lineIdx } = invalidMarker;
  // Clamp defensively: even with the version guard, out-of-range line numbers
  // must never make `lineAt` throw and take down the whole update.
  const clampedLineIdx = Math.max(0, Math.min(lineIdx, document.lineCount - 1));
  const line = document.lineAt(clampedLineIdx);
  const range = new vscode.Range(clampedLineIdx, 0, clampedLineIdx, line.text.length);
  const errorMsg = getErrorMessage(invalidMarker);
  const diagnostic = new vscode.Diagnostic(range, errorMsg, vscode.DiagnosticSeverity.Warning);
  diagnostic.source = EXTENSION_DISPLAY_NAME;
  return diagnostic;
}

function getErrorMessage(invalidMarker: InvalidMarker): string {
  switch (invalidMarker.boundaryType) {
    case "start":
      return "Unexpected region start: No matching end boundary found below.";
    case "end":
      return "Unexpected region end: No matching start boundary found above.";
    default:
      throwNever(invalidMarker.boundaryType);
  }
}
