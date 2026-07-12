import * as assert from "assert";
import * as vscode from "vscode";
import { RegionDiagnosticsManager } from "../../diagnostics/RegionDiagnosticsManager";
import { getDocumentId, getVersionedDocumentId } from "../../lib/getVersionedDocumentId";
import { type InvalidMarker } from "../../lib/parseAllRegions";
import { type RegionStore } from "../../state/RegionStore";
import { openInvalidSampleDocument, openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Regression tests for the diagnostics race / staleness bugs (plan item 2.5 /
 * 5.4). These drive a `RegionDiagnosticsManager` wired to a *fake* region store
 * so the schedule-time snapshot can be controlled deterministically, rather
 * than trying to win the real 300 ms-vs-250 ms debounce race by timing alone.
 */
class FakeRegionStore {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeInvalidMarkers = this.emitter.event;
  invalidMarkers: InvalidMarker[] = [];
  documentId: string | undefined = undefined;
  versionedDocumentId: string | undefined = undefined;

  fireInvalidMarkersChange(): void {
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}

const DEBOUNCE_WAIT_MS = 450; // > the manager's 300 ms debounce

suite("RegionDiagnosticsManager race / staleness (2.5)", function () {
  this.timeout(15000);

  let subscriptions: vscode.Disposable[];
  let fakeStore: FakeRegionStore;
  let manager: RegionDiagnosticsManager;

  setup(() => {
    subscriptions = [];
    fakeStore = new FakeRegionStore();
    manager = new RegionDiagnosticsManager(fakeStore as unknown as RegionStore, subscriptions);
  });

  teardown(async () => {
    manager.diagnostics.dispose();
    fakeStore.dispose();
    subscriptions.forEach((d) => {
      d.dispose();
    });
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  function pointFakeStoreAt(document: vscode.TextDocument, markers: InvalidMarker[]): void {
    fakeStore.documentId = getDocumentId(document);
    fakeStore.versionedDocumentId = getVersionedDocumentId(document);
    fakeStore.invalidMarkers = markers;
  }

  test("diagnostics land on the markers' document, not the active editor", async () => {
    // docA owns the invalid markers; docB is the active editor when the update
    // fires. Pre-fix the manager read `activeTextEditor` at fire time and set
    // docA's markers on docB's URI.
    const docA = await openInvalidSampleDocument("invalidSample.ts");
    // Pin docA in a non-preview tab: a document opened without an editor is
    // owned by the workbench and "might be closed at any time" (per the
    // `openTextDocument` API contract), and a mid-test close makes the manager
    // correctly drop the snapshot — failing the test for the wrong reason.
    await vscode.window.showTextDocument(docA, { preview: false });
    // A multi-line doc so that pre-fix code would actually place docA's marker
    // on docB's URI (rather than throwing on an out-of-range line).
    const docB = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(docB, { preview: false });

    pointFakeStoreAt(docA, [{ boundaryType: "end", lineIdx: 4 }]);
    fakeStore.fireInvalidMarkersChange();
    // Wait for the debounced apply instead of a fixed sleep. On regression
    // nothing ever lands on docA, so swallow the timeout and let the asserts
    // below produce the descriptive failure (including where markers DID land).
    await waitForCondition(
      () => (manager.diagnostics.get(docA.uri) ?? []).length > 0,
      5000,
      50
    ).catch(() => undefined);

    const onA = manager.diagnostics.get(docA.uri) ?? [];
    const onB = manager.diagnostics.get(docB.uri) ?? [];
    assert.strictEqual(onA.length, 1, "markers must land on their own document (docA)");
    assert.strictEqual(
      onB.length,
      0,
      "markers must NOT land on the active editor's document (docB)"
    );
  });

  test("closing a document clears its diagnostics", async () => {
    // Use a fresh untitled document: closing its editor disposes the document
    // and fires `onDidCloseTextDocument` promptly and deterministically (unlike
    // file-backed documents, which VS Code keeps cached for a while).
    const docA = await vscode.workspace.openTextDocument({
      content: "line0\nline1\nline2\n",
      language: "plaintext",
    });
    await vscode.window.showTextDocument(docA);

    pointFakeStoreAt(docA, [{ boundaryType: "end", lineIdx: 1 }]);
    fakeStore.fireInvalidMarkersChange();
    await delay(DEBOUNCE_WAIT_MS);
    assert.strictEqual(
      (manager.diagnostics.get(docA.uri) ?? []).length,
      1,
      "precondition: docA has a diagnostic before closing"
    );

    await vscode.commands.executeCommand("workbench.action.closeAllEditors");

    // Pre-fix there was no close listener, so this never becomes empty.
    await waitForCondition(
      () => (manager.diagnostics.get(docA.uri) ?? []).length === 0,
      5000,
      50
    );
    assert.strictEqual(
      (manager.diagnostics.get(docA.uri) ?? []).length,
      0,
      "closing docA must clear its diagnostics"
    );
  });

  test("out-of-range marker line numbers are clamped instead of throwing", async () => {
    const docA = await openSampleDocument("emptyDocument.ts");
    await vscode.window.showTextDocument(docA);

    // A line index far beyond the document — pre-fix `lineAt` threw and the
    // whole update was lost.
    pointFakeStoreAt(docA, [{ boundaryType: "start", lineIdx: 99_999 }]);
    fakeStore.fireInvalidMarkersChange();
    await delay(DEBOUNCE_WAIT_MS);

    const diagnostics = manager.diagnostics.get(docA.uri) ?? [];
    assert.strictEqual(diagnostics.length, 1, "a clamped marker still yields a diagnostic");
    const firstDiagnostic = diagnostics[0];
    assert.ok(firstDiagnostic, "diagnostic exists");
    assert.ok(
      firstDiagnostic.range.start.line < docA.lineCount,
      "diagnostic range must be clamped within the document"
    );
  });
});
