import * as assert from "assert";
import * as vscode from "vscode";
import { isIgnoredDocumentScheme } from "../../lib/documentScheme";

/**
 * Unit tests for plan 4.7b's scheme filter. Only a minimal `{ uri }` shape is
 * read, so we can exercise the predicate directly with fabricated URIs instead
 * of trying to open a real Output-panel document (which is not a normal text
 * editor a test can `showTextDocument`).
 */
suite("isIgnoredDocumentScheme (plan 4.7b)", () => {
  function docWithScheme(uri: vscode.Uri): vscode.TextDocument {
    return { uri } as vscode.TextDocument;
  }

  test("ignores the output: scheme (Output panel)", () => {
    const uri = vscode.Uri.parse("output:extension-output-DavidBookstaber.outline-regions-plus-%231");
    assert.strictEqual(uri.scheme, "output", "sanity: parsed URI should have the output scheme");
    assert.strictEqual(
      isIgnoredDocumentScheme(docWithScheme(uri)),
      true,
      "output:-scheme documents must be ignored (retain state, no parse/fetch)"
    );
  });

  test("does NOT ignore real source schemes (file, untitled)", () => {
    assert.strictEqual(
      isIgnoredDocumentScheme(docWithScheme(vscode.Uri.file("C:/tmp/example.ts"))),
      false,
      "file:-scheme documents are real source documents and must be handled"
    );
    assert.strictEqual(
      isIgnoredDocumentScheme(docWithScheme(vscode.Uri.parse("untitled:Untitled-1"))),
      false,
      "untitled: documents must be handled"
    );
  });

  test("does NOT ignore virtual-workspace schemes (the trees are scheme-agnostic)", () => {
    // Plan 4.5 counterpoint: virtual workspaces (vscode-vfs:, vsls:) must keep
    // working, so the filter is a deny-list, not an allow-list.
    assert.strictEqual(
      isIgnoredDocumentScheme(docWithScheme(vscode.Uri.parse("vscode-vfs://github/owner/repo/a.ts"))),
      false,
      "vscode-vfs: (github.dev / vscode.dev) documents must be handled"
    );
    assert.strictEqual(
      isIgnoredDocumentScheme(docWithScheme(vscode.Uri.parse("vsls:/shared/a.ts"))),
      false,
      "vsls: (Live Share) documents must be handled"
    );
  });
});
