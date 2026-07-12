import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Plan 6.1 — the extension must declare `capabilities.untrustedWorkspaces` so it
 * is not silently dead in Restricted Mode, while marking the one real attack
 * surface (workspace-injected region regexes) as a restricted configuration.
 *
 * Verified by inspection of the published `packageJSON` (the manifest-inspection
 * pattern established by manifestCommandPalette.test.ts).
 */
suite("Plan 6.1 — untrustedWorkspaces capability", () => {
  type Manifest = {
    capabilities?: {
      untrustedWorkspaces?: {
        supported?: unknown;
        restrictedConfigurations?: unknown;
      };
    };
  };

  function getManifest(): Manifest {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    assert.ok(extension, "Outline++ extension must be installed in the test host");
    return extension.packageJSON as Manifest;
  }

  test("declares limited support for untrusted workspaces", () => {
    const untrusted = getManifest().capabilities?.untrustedWorkspaces;
    assert.ok(untrusted, "capabilities.untrustedWorkspaces must be declared");
    assert.strictEqual(
      untrusted.supported,
      "limited",
      "untrusted workspaces must be 'limited' (not fully trusted, not disabled)"
    );
  });

  test("restricts the region-pattern configuration (the injectable-regex surface)", () => {
    const restricted = getManifest().capabilities?.untrustedWorkspaces?.restrictedConfigurations;
    assert.ok(Array.isArray(restricted), "restrictedConfigurations must be an array");
    assert.ok(
      restricted.includes("outlinePlus.regionBoundaryPatternByLanguageId"),
      "the workspace-injectable region-pattern setting must be restricted in untrusted workspaces"
    );
  });
});
