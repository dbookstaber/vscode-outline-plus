import * as assert from "assert";
import * as vscode from "vscode";
import { getCustomModifierIconPath, getDefaultModifiers } from "../../lib/symbolModifiers";

/**
 * Plan 6.9 — the custom modifier overlay icons must be theme-adaptive. Previously
 * a single Dark+ file was returned for both `light` and `dark`, giving low
 * contrast on light themes. They now resolve to distinct `assets/icons/light/*`
 * and `assets/icons/dark/*` variants.
 *
 * D-3 — icon URIs are built by joining onto the extension's own root URI with
 * `vscode.Uri.joinPath`, which PRESERVES scheme/authority. On the web (vscode.dev)
 * the extension root is a non-`file:` URI; the old `vscode.Uri.file(extensionPath)`
 * coerced every asset URI to `file://`, rendering blank icons. The tests below use
 * a non-`file:` root and assert the returned URIs keep that scheme/authority.
 */
suite("Plan 6.9 / D-3 — modifier overlay icons: distinct variants, scheme-preserving on web", () => {
  // A non-`file:` extension root, as produced on vscode.dev.
  const extUri = vscode.Uri.parse("vscode-test-web://mount/ext/root");

  test("a private method resolves to distinct light and dark SVG paths", () => {
    const modifiers = getDefaultModifiers();
    modifiers.visibility = "private";

    const icon = getCustomModifierIconPath("symbol-method", modifiers, extUri);

    assert.ok(icon, "a private method must have a custom overlay icon");
    assert.match(icon.light.path, /\/assets\/icons\/light\/method-private\.svg$/);
    assert.match(icon.dark.path, /\/assets\/icons\/dark\/method-private\.svg$/);
    assert.notStrictEqual(
      icon.light.toString(),
      icon.dark.toString(),
      "light and dark variants must be different files"
    );
  });

  test("a static field resolves to the static variant in both theme folders", () => {
    const modifiers = getDefaultModifiers();
    modifiers.memberModifiers.isStatic = true;

    const icon = getCustomModifierIconPath("symbol-field", modifiers, extUri);

    assert.ok(icon);
    assert.match(icon.light.path, /\/light\/field-static\.svg$/);
    assert.match(icon.dark.path, /\/dark\/field-static\.svg$/);
  });

  test("icon URIs preserve the extension root's scheme and authority (web-safe)", () => {
    const modifiers = getDefaultModifiers();
    modifiers.visibility = "private";

    const icon = getCustomModifierIconPath("symbol-method", modifiers, extUri);

    assert.ok(icon, "a private method must have a custom overlay icon");
    // The old Uri.file(extensionPath) path coerced these to the `file` scheme.
    assert.strictEqual(icon.light.scheme, "vscode-test-web", "light URI must keep the web scheme");
    assert.strictEqual(icon.dark.scheme, "vscode-test-web", "dark URI must keep the web scheme");
    assert.strictEqual(icon.light.authority, "mount", "light URI must keep the root authority");
    assert.strictEqual(icon.dark.authority, "mount", "dark URI must keep the root authority");
  });

  test("unsupported symbol kinds have no custom overlay icon", () => {
    const modifiers = getDefaultModifiers();
    modifiers.visibility = "private";

    assert.strictEqual(
      getCustomModifierIconPath("symbol-class", modifiers, extUri),
      undefined,
      "only method/property/field get overlay icons"
    );
  });
});
