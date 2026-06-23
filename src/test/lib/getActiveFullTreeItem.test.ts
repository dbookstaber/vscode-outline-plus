import * as assert from "assert";
import * as vscode from "vscode";
import { type FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { getActiveFullTreeItem } from "../../treeView/fullTreeView/getActiveFullTreeItem";

/**
 * Unit tests for {@link getActiveFullTreeItem}. The function only reads `range`
 * and `children`, so we build lightweight stand-ins instead of the full
 * `FullTreeItem` (whose constructor needs icons, modifiers, commands, etc.).
 */
suite("getActiveFullTreeItem", () => {
  function makeItem(
    displayName: string,
    startLine: number,
    endLine: number,
    children: FullTreeItem[] = []
  ): FullTreeItem {
    return {
      displayName,
      range: new vscode.Range(startLine, 0, endLine, 0),
      children,
    } as unknown as FullTreeItem;
  }

  test("returns the deepest item in a normally-nested tree", () => {
    const credentials = makeItem("credentials", 27, 27);
    const loginUser = makeItem("login_user", 26, 28, [credentials]);
    const userOps = makeItem("User Operations", 21, 29, [loginUser]);
    const cls = makeItem("AuthenticationService", 1, 29, [userOps]);
    const services = makeItem("Services", 0, 31, [cls]);

    const active = getActiveFullTreeItem([services], new vscode.Position(27, 0));
    assert.strictEqual(active?.displayName, "credentials");
  });

  test("picks the tighter region when a region marker overlaps an enclosing symbol", () => {
    // Reproduces the python.py bug: the `# region User Operations` marker (line 21)
    // sits inside the class, but the region's range runs to its `#endregion` (line 29),
    // which extends past the class symbol's end (line 28). So the class symbol and the
    // region are overlapping siblings that BOTH contain line 21. The cursor on the
    // marker line should highlight the tighter region, not the broader class.
    const cls = makeItem("AuthenticationService", 1, 28, [
      makeItem("Setup & State", 3, 7),
      makeItem("Factory & Static Helpers", 9, 19),
    ]);
    const userOps = makeItem("User Operations", 21, 29, [
      makeItem("current_token", 22, 24),
      makeItem("login_user", 26, 28),
    ]);
    const services = makeItem("Services", 0, 31, [cls, userOps]);

    const active = getActiveFullTreeItem([services], new vscode.Position(21, 4));
    assert.strictEqual(active?.displayName, "User Operations");
  });

  test("returns undefined when the cursor is outside every item", () => {
    const services = makeItem("Services", 0, 31, [makeItem("AuthenticationService", 1, 28)]);
    const active = getActiveFullTreeItem([services], new vscode.Position(40, 0));
    assert.strictEqual(active, undefined);
  });
});
