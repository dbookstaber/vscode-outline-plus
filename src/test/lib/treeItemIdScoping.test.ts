import * as assert from "assert";
import * as vscode from "vscode";
import { type Region } from "../../models/Region";
import {
    getFlattenedRegionFullTreeItems,
    getFlattenedSymbolFullTreeItems,
} from "../../treeView/fullTreeView/getFlattenedFullTreeItems";
import { RegionTreeItem } from "../../treeView/regionTreeView/RegionTreeItem";

/**
 * Regression tests for plan D-5: tree-item ids used to be purely content-based
 * (e.g. "region-Foo-1"), so a same-named symbol/region in two different files
 * produced identical ids and cross-contaminated VS Code's per-view expansion
 * memory. Ids are now scoped to their document.
 */
suite("Plan D-5 — tree item ids are scoped to their document", () => {
  const DOC_A = "file:///a.ts";
  const DOC_B = "file:///b.ts";

  function makeRegion(name: string): Region {
    return {
      id: `${name}-1`,
      name,
      range: new vscode.Range(0, 0, 5, 0),
      regionIdx: 0,
      wasClosed: true,
      children: [],
    };
  }

  test("same-named region in two files yields distinct FullTreeItem ids", () => {
    const region = makeRegion("Foo");
    const [itemA] = getFlattenedRegionFullTreeItems([region], DOC_A);
    const [itemB] = getFlattenedRegionFullTreeItems([region], DOC_B);
    assert.ok(itemA && itemB);
    assert.notStrictEqual(itemA.id, itemB.id, "ids for the same region in two files must differ");
    assert.ok(itemA.id.includes(DOC_A), "id A should be scoped to document A");
    assert.ok(itemB.id.includes(DOC_B), "id B should be scoped to document B");
  });

  test("same-named symbol in two files yields distinct FullTreeItem ids", () => {
    const symbol = new vscode.DocumentSymbol(
      "Bar",
      "",
      vscode.SymbolKind.Class,
      new vscode.Range(0, 0, 10, 0),
      new vscode.Range(0, 0, 0, 3)
    );
    const [a] = getFlattenedSymbolFullTreeItems([symbol], undefined, DOC_A);
    const [b] = getFlattenedSymbolFullTreeItems([symbol], undefined, DOC_B);
    assert.ok(a && b);
    assert.notStrictEqual(a.id, b.id, "ids for the same symbol in two files must differ");
  });

  test("RegionTreeItem scopes its VS Code id but keeps an unscoped nav argument", () => {
    const region = makeRegion("Foo");
    const a = new RegionTreeItem(region, vscode.TreeItemCollapsibleState.None, DOC_A);
    const b = new RegionTreeItem(region, vscode.TreeItemCollapsibleState.None, DOC_B);
    assert.notStrictEqual(a.id, b.id, "RegionTreeItem ids must differ across documents");
    // The nav command argument stays the unscoped region.id so RegionStore (which
    // keys regions by that id) can resolve the target at click time.
    assert.deepStrictEqual(a.command?.arguments, ["Foo-1"]);
  });
});
