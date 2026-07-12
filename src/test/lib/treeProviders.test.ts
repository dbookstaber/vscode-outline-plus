import * as assert from "assert";
import * as vscode from "vscode";
import { type CollapsibleStateManager } from "../../state/CollapsibleStateManager";
import { type FullOutlineStore } from "../../state/FullOutlineStore";
import { RegionStore } from "../../state/RegionStore";
import { FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { FullTreeViewProvider } from "../../treeView/fullTreeView/FullTreeViewProvider";
import { RegionTreeItem } from "../../treeView/regionTreeView/RegionTreeItem";
import { RegionTreeViewProvider } from "../../treeView/regionTreeView/RegionTreeViewProvider";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Provider-level integration tests (plan 5.2).
 *
 * The two user-visible trees are otherwise only exercised indirectly (via the
 * highlight-reveal gate and the exported outline API). These tests drive the
 * real providers' `getChildren` / `getTreeItem` and assert the *rendered* tree
 * item shape: label, icon (ThemeIcon id or {light,dark} path), and resolved
 * collapsibleState — for both the Regions view and the Full Outline view.
 *
 * - Regions view: driven by a real `RegionStore` parsed from a real sample
 *   document (region parsing is synchronous, no language server needed).
 * - Full Outline view: driven by synthesized `FullTreeItem`s through a fake
 *   store, so the symbol-with-modifiers and icon-path cases are deterministic
 *   and don't depend on a language server's symbol output.
 */
suite("Tree providers getChildren / getTreeItem (plan 5.2)", function () {
  this.timeout(10000);

  /** Collapsible-state manager stub: no persisted state ⇒ parents default to Expanded. */
  const noSavedStateManager = {
    getSavedCollapsibleState: () => undefined,
    onCollapseTreeItem: () => undefined,
    onExpandTreeItem: () => undefined,
    onExpandAllTreeItems: () => undefined,
  } as unknown as CollapsibleStateManager;

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  // #region Regions view (real store)

  suite("Regions view (real RegionStore + RegionTreeViewProvider)", () => {
    let subscriptions: vscode.Disposable[];
    let regionStore: RegionStore;
    let provider: RegionTreeViewProvider;

    async function setup(): Promise<void> {
      const doc = await openSampleDocument("sampleRegionsDocument.ts");
      await vscode.window.showTextDocument(doc);
      await waitForCondition(
        () => vscode.window.activeTextEditor?.document === doc,
        3000,
        25
      );
      subscriptions = [];
      regionStore = new RegionStore(subscriptions);
      // Parse the active document synchronously (bypasses the 250 ms debounce).
      regionStore.forceRefresh();
      provider = new RegionTreeViewProvider(regionStore, noSavedStateManager, subscriptions);
    }

    teardown(() => {
      regionStore.dispose();
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
    });

    test("top-level getChildren returns the document's top-level regions in order", async () => {
      await setup();
      const topLevel = provider.getChildren();
      const labels = topLevel.map((region) => provider.getTreeItem(region).label);
      assert.deepStrictEqual(labels, ["Imports", "Classes", "Type Definitions", "Unnamed region"]);
    });

    test("a region with children reports its children via getChildren", async () => {
      await setup();
      const classes = provider.getChildren().find((r) => r.name === "Classes");
      assert.ok(classes, "sample must contain a 'Classes' region");
      const childLabels = provider
        .getChildren(classes)
        .map((child) => provider.getTreeItem(child).label);
      assert.deepStrictEqual(childLabels, ["Constructor", "Methods", "Sibling Classes"]);
    });

    test("getTreeItem yields a RegionTreeItem with the namespace icon", async () => {
      await setup();
      const imports = provider.getChildren().find((r) => r.name === "Imports");
      assert.ok(imports);
      const treeItem = provider.getTreeItem(imports);
      assert.ok(treeItem instanceof RegionTreeItem, "region rows are RegionTreeItems");
      assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon, "region icon is a ThemeIcon");
      assert.strictEqual(treeItem.iconPath.id, "symbol-namespace");
    });

    test("collapsibleState: Expanded for a region with children, None for a leaf", async () => {
      await setup();
      const children = provider.getChildren();
      const classes = children.find((r) => r.name === "Classes");
      const imports = children.find((r) => r.name === "Imports");
      assert.ok(classes && imports);
      assert.strictEqual(
        provider.getTreeItem(classes).collapsibleState,
        vscode.TreeItemCollapsibleState.Expanded,
        "a region with children defaults to Expanded when no state is persisted"
      );
      assert.strictEqual(
        provider.getTreeItem(imports).collapsibleState,
        vscode.TreeItemCollapsibleState.None,
        "a leaf region is non-collapsible"
      );
    });
  });

  // #endregion

  // #region Full Outline view (synthesized items)

  suite("Full Outline view (FullTreeViewProvider over synthesized items)", () => {
    let subscriptions: vscode.Disposable[];
    let onDidChangeItems: vscode.EventEmitter<void>;
    let onDidChangeActiveItem: vscode.EventEmitter<void>;
    let provider: FullTreeViewProvider;
    let regionItem: FullTreeItem;
    let symbolWithModifiers: FullTreeItem;
    let nestedSymbol: FullTreeItem;

    setup(() => {
      nestedSymbol = new FullTreeItem({
        id: "sym-nested-0",
        displayName: "getId",
        range: new vscode.Range(10, 2, 12, 3),
        selectionRange: new vscode.Range(10, 10, 10, 15),
        itemType: "symbol",
        parent: undefined,
        children: [],
        icon: new vscode.ThemeIcon("symbol-method"),
      });

      // A region with one child (covers "region with children" + path icon).
      regionItem = new FullTreeItem({
        id: "region-Classes-0",
        displayName: "Classes",
        range: new vscode.Range(0, 0, 20, 0),
        itemType: "region",
        parent: undefined,
        children: [nestedSymbol],
        icon: {
          light: vscode.Uri.file("/icons/light/namespace.svg"),
          dark: vscode.Uri.file("/icons/dark/namespace.svg"),
        },
      });
      nestedSymbol.parent = regionItem;

      // A leaf symbol carrying a modifier badge prefix (badge label shape).
      symbolWithModifiers = new FullTreeItem({
        id: "sym-locked-0",
        displayName: "secret",
        range: new vscode.Range(30, 2, 30, 20),
        selectionRange: new vscode.Range(30, 14, 30, 20),
        itemType: "symbol",
        parent: undefined,
        children: [],
        icon: new vscode.ThemeIcon("symbol-field"),
        modifierLabelPrefix: "🔒ˢ ",
        modifierDescription: "private static",
      });

      subscriptions = [];
      onDidChangeItems = new vscode.EventEmitter<void>();
      onDidChangeActiveItem = new vscode.EventEmitter<void>();
      const fakeStore = {
        activeFullOutlineItem: undefined,
        topLevelFullOutlineItems: [regionItem, symbolWithModifiers],
        documentId: undefined,
        allParentIds: new Set<string>(),
        onDidChangeFullOutlineItems: onDidChangeItems.event,
        onDidChangeActiveFullOutlineItem: onDidChangeActiveItem.event,
      } as unknown as FullOutlineStore;
      provider = new FullTreeViewProvider(fakeStore, noSavedStateManager, subscriptions);
    });

    teardown(() => {
      for (const disposable of subscriptions) {
        disposable.dispose();
      }
      onDidChangeItems.dispose();
      onDidChangeActiveItem.dispose();
    });

    test("top-level getChildren preserves item order", () => {
      const topLevel = provider.getChildren();
      assert.deepStrictEqual(
        topLevel.map((item) => item.id),
        ["region-Classes-0", "sym-locked-0"]
      );
    });

    test("a region item reports its child symbol via getChildren", () => {
      const children = provider.getChildren(regionItem);
      assert.deepStrictEqual(
        children.map((item) => item.displayName),
        ["getId"]
      );
    });

    test("a symbol with modifiers renders the badge prefix on its label", () => {
      const treeItem = provider.getTreeItem(symbolWithModifiers);
      assert.strictEqual(treeItem.label, "🔒ˢ secret", "label is prefix + display name");
      assert.strictEqual(treeItem.description, "private static");
    });

    test("region icon is exposed as a {light,dark} path pair", () => {
      const treeItem = provider.getTreeItem(regionItem);
      const iconPath = treeItem.iconPath as { light: vscode.Uri; dark: vscode.Uri };
      assert.ok(iconPath.light instanceof vscode.Uri && iconPath.dark instanceof vscode.Uri);
      assert.match(iconPath.dark.fsPath, /namespace\.svg$/);
    });

    test("symbol icon is exposed as a ThemeIcon id", () => {
      const treeItem = provider.getTreeItem(nestedSymbol);
      assert.ok(treeItem.iconPath instanceof vscode.ThemeIcon);
      assert.strictEqual(treeItem.iconPath.id, "symbol-method");
    });

    test("collapsibleState: Expanded for the region-with-children, None for the leaf symbol", () => {
      assert.strictEqual(
        provider.getTreeItem(regionItem).collapsibleState,
        vscode.TreeItemCollapsibleState.Expanded
      );
      assert.strictEqual(
        provider.getTreeItem(symbolWithModifiers).collapsibleState,
        vscode.TreeItemCollapsibleState.None
      );
    });
  });

  // #endregion
});
