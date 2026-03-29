import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlinePlusAPI } from "../../api/regionHelperAPI";
import { type FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Integration tests for modifier extraction in the Full Outline tree view.
 *
 * These tests open real sample files, wait for the extension to parse them fully,
 * and then assert that the FullTreeItem objects expose the correct modifiers.
 * This validates the entire pipeline end-to-end: language server → DocumentSymbolStore
 * → extractSymbolModifiers → FullTreeItem.modifiers.
 *
 * IMPORTANT: These tests depend on the C# language extension being available in the
 * test host. If no C# language grammar is installed, the language server won't provide
 * DocumentSymbol data and these tests will be skipped.
 */
suite("Modifier Extraction Integration", function () {
  this.timeout(15000);

  let regionHelperAPI: OutlinePlusAPI;

  suiteSetup(async () => {
    const regionHelperExtension = vscode.extensions.getExtension("DavidBookstaber.outline-plus");
    if (!regionHelperExtension) {
      throw new Error("Outline++ extension not found!");
    }
    await regionHelperExtension.activate();
    regionHelperAPI = regionHelperExtension.exports as OutlinePlusAPI;
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  /**
   * Collect all FullTreeItems recursively (depth-first) from the tree.
   */
  function flattenItems(items: FullTreeItem[]): FullTreeItem[] {
    const result: FullTreeItem[] = [];
    for (const item of items) {
      result.push(item);
      if (item.children.length > 0) {
        result.push(...flattenItems(item.children));
      }
    }
    return result;
  }

  /**
   * Find a symbol item in the flat list by display name.
   */
  function findSymbol(allItems: FullTreeItem[], name: string): FullTreeItem | undefined {
    return allItems.find((i) => i.itemType === "symbol" && i.displayName === name);
  }

  test("C# sample: modifiers extracted correctly despite misleading comments", async () => {
    const doc = await openSampleDocument("modifierSample.cs");
    await vscode.window.showTextDocument(doc);

    // Wait for outline items to be populated with both regions and symbols
    await waitForCondition(
      () => {
        const items = regionHelperAPI.getTopLevelFullOutlineItems();
        const flat = flattenItems(items);
        // Require at least one symbol-type item (meaning the language server responded)
        return flat.some((i) => i.itemType === "symbol");
      },
      10000,
      100
    );

    const allItems = flattenItems(regionHelperAPI.getTopLevelFullOutlineItems());
    const symbols = allItems.filter((i) => i.itemType === "symbol");

    // If no real C# symbols were produced (language server unavailable),
    // skip this test. Without a C# language server, VS Code may still
    // produce generic symbols (e.g. "var0_0") that don't represent real
    // C# declarations, so we check for our expected names, not just count.
    const expectedNames = [
      "PublicAfterPrivateComment",
      "PublicAfterPrivateLineComment",
      "PublicAfterBlockComment",
      "ProtectedMethod",
      "PrivateMethod",
      "InternalMethod",
      "StaticMethod",
    ];
    const foundCount = expectedNames.filter((n) => findSymbol(allItems, n) !== undefined).length;
    if (foundCount === 0) {
      // No C# language server; nothing to assert.
      return;
    }

    // --- Visibility assertions ---

    const publicAfterPrivateComment = findSymbol(allItems, "PublicAfterPrivateComment");
    if (publicAfterPrivateComment) {
      assert.strictEqual(
        publicAfterPrivateComment.modifiers.visibility,
        "public",
        "PublicAfterPrivateComment: XML doc with 'private' must not override public"
      );
      assert.strictEqual(publicAfterPrivateComment.modifiers.memberModifiers.isStatic, true);
    }

    const publicAfterPrivateLineComment = findSymbol(allItems, "PublicAfterPrivateLineComment");
    if (publicAfterPrivateLineComment) {
      assert.strictEqual(
        publicAfterPrivateLineComment.modifiers.visibility,
        "public",
        "PublicAfterPrivateLineComment: line comment with 'private' must not override public"
      );
      assert.strictEqual(publicAfterPrivateLineComment.modifiers.memberModifiers.isStatic, true);
    }

    const publicAfterBlockComment = findSymbol(allItems, "PublicAfterBlockComment");
    if (publicAfterBlockComment) {
      assert.strictEqual(
        publicAfterBlockComment.modifiers.visibility,
        "public",
        "PublicAfterBlockComment: block comment with 'private' must not override public"
      );
    }

    const protectedMethod = findSymbol(allItems, "ProtectedMethod");
    if (protectedMethod) {
      assert.strictEqual(protectedMethod.modifiers.visibility, "protected");
    }

    const privateMethod = findSymbol(allItems, "PrivateMethod");
    if (privateMethod) {
      assert.strictEqual(privateMethod.modifiers.visibility, "private");
    }

    const internalMethod = findSymbol(allItems, "InternalMethod");
    if (internalMethod) {
      assert.strictEqual(internalMethod.modifiers.visibility, "internal");
    }

    // --- Member modifier assertions ---

    const staticMethod = findSymbol(allItems, "StaticMethod");
    if (staticMethod) {
      assert.strictEqual(staticMethod.modifiers.memberModifiers.isStatic, true);
      assert.strictEqual(staticMethod.modifiers.visibility, "public");
    }

    // Sanity check: at least 3 of our expected names should be present
    assert.ok(
      foundCount >= 3,
      `Expected at least 3 symbols to be found for assertions, got ${foundCount}. ` +
      `Available symbols: ${symbols.map((s) => s.displayName).join(", ")}`
    );
  });

  test("C# sample: #region directives do not pollute modifier extraction", async () => {
    // The modifierSample.cs file has #region directives with visibility keywords
    // (e.g., "#region Private Helpers"). These must not affect the symbols inside.
    const doc = await openSampleDocument("modifierSample.cs");
    await vscode.window.showTextDocument(doc);

    await waitForCondition(
      () => {
        const items = regionHelperAPI.getTopLevelFullOutlineItems();
        const flat = flattenItems(items);
        return flat.some((i) => i.itemType === "symbol");
      },
      10000,
      100
    );

    const allItems = flattenItems(regionHelperAPI.getTopLevelFullOutlineItems());

    // If no real C# symbols are available, skip this test.
    if (!findSymbol(allItems, "PublicAfterPrivateComment")) {
      return;
    }

    const regions = allItems.filter((i) => i.itemType === "region");

    // Verify regions were found (the file has #region directives)
    assert.ok(regions.length > 0, "Should have region items from #region directives");

    // Verify symbols inside regions have correct modifiers
    const publicAfterPrivateComment = findSymbol(allItems, "PublicAfterPrivateComment");
    if (publicAfterPrivateComment) {
      assert.strictEqual(
        publicAfterPrivateComment.modifiers.visibility,
        "public",
        "Symbol inside '#region Private Helpers' must still be detected as public"
      );
    }
  });
});
