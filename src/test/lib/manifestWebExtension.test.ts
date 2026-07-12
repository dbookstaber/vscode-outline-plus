import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Plan D-3 — the extension ships a web (Web Worker) bundle for vscode.dev /
 * github.dev alongside the desktop (Node) bundle. Verified by inspection of the
 * published manifest (the pattern from manifestCommandPalette.test.ts).
 */
suite("Plan D-3 — web extension entry point", () => {
  function getManifest(): { main?: unknown; browser?: unknown } {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    assert.ok(extension, "Outline++ extension must be installed in the test host");
    return extension.packageJSON as { main?: unknown; browser?: unknown };
  }

  test("declares both a desktop 'main' and a web 'browser' entry point", () => {
    const manifest = getManifest();
    assert.strictEqual(manifest.main, "./dist/extension.js", "desktop entry point must remain declared");
    assert.strictEqual(
      manifest.browser,
      "./dist/web/extension.js",
      "web-worker entry point must be declared so the extension loads on vscode.dev"
    );
  });
});
