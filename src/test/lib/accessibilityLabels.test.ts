import * as assert from "assert";
import * as vscode from "vscode";
import { getDefaultModifiers, type SymbolModifiers } from "../../lib/symbolModifiers";
import { FullTreeItem, buildAccessibilityLabel } from "../../treeView/fullTreeView/FullTreeItem";
import { RegionTreeItem } from "../../treeView/regionTreeView/RegionTreeItem";
import { type Region } from "../../models/Region";
import { assertExists } from "../../utils/assertUtils";

/**
 * Plan 6.8 — accessibility labels.
 *
 * David's ruling: KEEP the visual emoji badge as the default `label`, but give
 * assistive tech a clean, semantic `accessibilityInformation.label` (no emoji)
 * so screen readers and type-ahead don't lead with "🔒ˢ …".
 */
suite("Tree item accessibility labels (plan 6.8)", () => {
  const EMOJI = /\p{Extended_Pictographic}/u;

  function privateStaticModifiers(): SymbolModifiers {
    const modifiers = getDefaultModifiers();
    modifiers.visibility = "private";
    modifiers.memberModifiers.isStatic = true;
    return modifiers;
  }

  suite("buildAccessibilityLabel (pure)", () => {
    test("spells out modifiers + role + name", () => {
      assert.strictEqual(
        buildAccessibilityLabel("Foo", privateStaticModifiers(), "method"),
        "private static method Foo"
      );
    });

    test("falls back to role + name when no modifiers", () => {
      assert.strictEqual(
        buildAccessibilityLabel("Imports", getDefaultModifiers(), "region"),
        "region Imports"
      );
    });

    test("falls back to the bare name when neither modifiers nor role are present", () => {
      assert.strictEqual(buildAccessibilityLabel("Foo", getDefaultModifiers(), undefined), "Foo");
    });
  });

  suite("FullTreeItem", () => {
    test("keeps the emoji badge on the visible label but exposes a clean a11y label", () => {
      const item = new FullTreeItem({
        id: "sym-secret-0",
        displayName: "secret",
        range: new vscode.Range(0, 0, 0, 10),
        itemType: "symbol",
        parent: undefined,
        children: [],
        icon: new vscode.ThemeIcon("symbol-field"),
        modifiers: privateStaticModifiers(),
        modifierLabelPrefix: "🔒ˢ ",
        accessibilityRole: "field",
      });

      assert.strictEqual(item.label, "🔒ˢ secret", "visible label keeps the badge (emoji included)");

      const a11y = item.accessibilityInformation;
      assertExists(a11y);
      assert.strictEqual(a11y.label, "private static field secret");
      assert.ok(!EMOJI.test(a11y.label), "a11y label carries no emoji/badge glyphs");
    });

    test("region item a11y label is role-qualified and emoji-free", () => {
      const item = new FullTreeItem({
        id: "region-Imports-0",
        displayName: "Imports",
        range: new vscode.Range(0, 0, 5, 0),
        itemType: "region",
        parent: undefined,
        children: [],
        icon: new vscode.ThemeIcon("symbol-namespace"),
        accessibilityRole: "region",
      });
      const a11y = item.accessibilityInformation;
      assertExists(a11y);
      assert.strictEqual(a11y.label, "region Imports");
    });
  });

  suite("RegionTreeItem", () => {
    test("a11y label is the role-qualified region name", () => {
      const region: Region = {
        id: "Imports-1",
        name: "Imports",
        range: new vscode.Range(0, 0, 5, 0),
        regionIdx: 0,
        wasClosed: true,
        children: [],
      };
      const item = new RegionTreeItem(region, vscode.TreeItemCollapsibleState.None, "doc-1");
      const a11y = item.accessibilityInformation;
      assertExists(a11y);
      assert.strictEqual(a11y.label, "region Imports");
      assert.ok(!EMOJI.test(a11y.label));
    });
  });
});
