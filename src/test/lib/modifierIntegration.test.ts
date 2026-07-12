import * as assert from "assert";
import * as vscode from "vscode";
import { type FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Integration tests for modifier extraction in the Full Outline tree view.
 *
 * These tests open a real TypeScript sample file, wait for the extension to
 * parse it fully, and assert that the FullTreeItem objects expose the correct
 * modifiers. This validates the whole pipeline end-to-end: language server →
 * DocumentSymbolStore → extractSymbolModifiers → FullTreeItem.modifiers.
 *
 * We deliberately target TypeScript (not C#): the TypeScript language server
 * is guaranteed to be present in the isolated test host, whereas no C# symbol
 * provider is installed (see `.vscode-test.mjs`). An earlier version of this
 * suite opened a `.cs` file, found no C# symbols, and silently `return`ed —
 * so it "passed" without ever asserting anything (and only reached its symbol
 * gate at all via stale symbol items left over from prior suites).
 *
 * Every assertion below is keyed to a symbol whose name is unique to
 * `modifierSample.ts`, so a passing assertion proves the symbol came from the
 * sample document itself, not from stale state. If the TypeScript server fails
 * to produce symbols at all, the test `this.skip()`s rather than passing
 * vacuously.
 *
 * Uses the extension's internal `_test_getInternalFullOutlineItems` hook because
 * `modifiers` is intentionally stripped at the `OutlineInternalAPI` boundary by
 * the `OutlineItem` converter. We cannot reach the runtime `FullOutlineStore`
 * instance directly from tests: the test webpack bundle ships its own module
 * copy of the class.
 */
type InternalHandle = {
  _test_getInternalFullOutlineItems(): FullTreeItem[];
};

suite("Modifier Extraction Integration", function () {
  this.timeout(15000);

  let internalHandle: InternalHandle;

  suiteSetup(async () => {
    const regionHelperExtension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!regionHelperExtension) {
      throw new Error("Outline++ extension not found!");
    }
    await regionHelperExtension.activate();
    internalHandle = regionHelperExtension.exports as InternalHandle;
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
   * Find a symbol item in the full tree by display name.
   */
  function findSymbol(name: string): FullTreeItem | undefined {
    const all = flattenItems(internalHandle._test_getInternalFullOutlineItems());
    return all.find((i) => i.itemType === "symbol" && i.displayName === name);
  }

  /**
   * True if the full tree contains any item (region or symbol) with the given
   * display name — used to prove the singleton store has actually converged onto
   * a specific document rather than passing on stale items from a prior test.
   */
  function outlineHasName(name: string): boolean {
    return flattenItems(internalHandle._test_getInternalFullOutlineItems()).some(
      (i) => i.displayName === name
    );
  }

  /**
   * Open the sample and wait until the outline contains the given symbol,
   * proving the TypeScript server responded for THIS document. Returns the
   * symbol; if it never appears, signals a genuine environmental skip so the
   * caller can `this.skip()`.
   *
   * Freshness guard (D-4): Wave-3's retain-on-undefined policy leaves the prior
   * test's modifierSample outline resident in the singleton store after
   * `closeAllEditors` teardown, so a bare wait for the anchor could be satisfied
   * INSTANTLY by stale items (never validating a fresh parse). We first open a
   * DIFFERENT document (sampleRegionsDocument.ts) and wait until the store has
   * demonstrably converged away from modifierSample — the anchor is gone AND a
   * name unique to the other document is present — so a subsequent anchor hit is
   * provably from a fresh parse of modifierSample.ts.
   */
  async function openSampleAndWaitForSymbol(name: string): Promise<FullTreeItem | undefined> {
    const otherDoc = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(otherDoc);
    try {
      await waitForCondition(
        () => findSymbol(name) === undefined && outlineHasName("MainClass"),
        10000,
        100
      );
    } catch {
      // The other document never converged (e.g. TS server silent) — treat as a
      // genuine environmental skip rather than validating against stale state.
      return undefined;
    }

    const doc = await openSampleDocument("modifierSample.ts");
    await vscode.window.showTextDocument(doc);
    try {
      await waitForCondition(() => findSymbol(name) !== undefined, 10000, 100);
    } catch {
      return undefined;
    }
    return findSymbol(name);
  }

  test("TS sample: modifiers extracted correctly despite misleading comments", async function () {
    const anchor = await openSampleAndWaitForSymbol("publicAfterPrivateComment");
    if (anchor === undefined) {
      // TypeScript symbol provider did not respond — a genuine environmental
      // skip, not a passing test.
      this.skip();
    }

    // --- Visibility: misleading comments must not override the declaration ---

    const publicAfterPrivateComment = findSymbol("publicAfterPrivateComment");
    assert.ok(publicAfterPrivateComment, "publicAfterPrivateComment symbol should exist");
    assert.strictEqual(
      publicAfterPrivateComment.modifiers.visibility,
      "public",
      "JSDoc containing 'private' must not override the 'public' declaration"
    );
    assert.strictEqual(
      publicAfterPrivateComment.modifiers.memberModifiers.isStatic,
      true,
      "publicAfterPrivateComment is declared static"
    );

    const publicAfterPrivateLineComment = findSymbol("publicAfterPrivateLineComment");
    assert.ok(publicAfterPrivateLineComment, "publicAfterPrivateLineComment symbol should exist");
    assert.strictEqual(
      publicAfterPrivateLineComment.modifiers.visibility,
      "public",
      "A line comment containing 'private' must not override 'public'"
    );
    assert.strictEqual(publicAfterPrivateLineComment.modifiers.memberModifiers.isStatic, true);

    const publicAfterBlockComment = findSymbol("publicAfterBlockComment");
    assert.ok(publicAfterBlockComment, "publicAfterBlockComment symbol should exist");
    assert.strictEqual(
      publicAfterBlockComment.modifiers.visibility,
      "public",
      "A block comment containing 'private' must not override 'public'"
    );

    const protectedMethod = findSymbol("protectedMethod");
    assert.ok(protectedMethod, "protectedMethod symbol should exist");
    assert.strictEqual(protectedMethod.modifiers.visibility, "protected");

    const privateMethod = findSymbol("privateMethod");
    assert.ok(privateMethod, "privateMethod symbol should exist");
    assert.strictEqual(privateMethod.modifiers.visibility, "private");

    // --- Member modifiers ---

    const staticMethod = findSymbol("staticMethod");
    assert.ok(staticMethod, "staticMethod symbol should exist");
    assert.strictEqual(staticMethod.modifiers.memberModifiers.isStatic, true);
    assert.strictEqual(staticMethod.modifiers.visibility, "public");

    const readOnlyField = findSymbol("readOnlyField");
    assert.ok(readOnlyField, "readOnlyField symbol should exist");
    assert.strictEqual(readOnlyField.modifiers.memberModifiers.isReadonly, true);
    assert.strictEqual(readOnlyField.modifiers.visibility, "public");

    const asyncMethod = findSymbol("asyncMethod");
    assert.ok(asyncMethod, "asyncMethod symbol should exist");
    assert.strictEqual(asyncMethod.modifiers.memberModifiers.isAsync, true);
    assert.strictEqual(asyncMethod.modifiers.visibility, "public");
  });

  test("TS sample: #region directives do not pollute modifier extraction", async function () {
    // modifierSample.ts wraps members in `// #region Private Helpers` and
    // `// #region Static Members`. Those directives must not leak visibility
    // keywords into the symbols inside them.
    const anchor = await openSampleAndWaitForSymbol("publicAfterPrivateComment");
    if (anchor === undefined) {
      this.skip();
    }

    const allItems = flattenItems(internalHandle._test_getInternalFullOutlineItems());
    const regions = allItems.filter((i) => i.itemType === "region");
    assert.ok(regions.length > 0, "Should have region items from the #region directives");
    assert.ok(
      regions.some((r) => r.displayName === "Private Helpers"),
      "The 'Private Helpers' region should be present"
    );

    // A symbol inside '#region Private Helpers' must still read as public.
    const publicAfterPrivateComment = findSymbol("publicAfterPrivateComment");
    assert.ok(publicAfterPrivateComment, "publicAfterPrivateComment symbol should exist");
    assert.strictEqual(
      publicAfterPrivateComment.modifiers.visibility,
      "public",
      "Symbol inside '#region Private Helpers' must still be detected as public"
    );
  });
});
