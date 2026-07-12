import * as assert from "assert";
import * as vscode from "vscode";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Regression test for Plan 2.V1 — changing `modifierDisplay` /
 * `useDistinctModifierColors` had no visible effect until an unrelated
 * structural rebuild. There was no `onDidChangeConfiguration` listener covering
 * these settings, and FullOutlineStore's change-detection compares only
 * id/name/type/range (not icons/labels), so nothing re-rendered.
 *
 * The fix adds a listener that forces a rebuild + event fire. This test changes
 * the config via `getConfiguration().update()` with NO document edit and asserts
 * the outline items' presentation changes.
 */

type InternalFullTreeItem = {
  displayName: string;
  label: string | vscode.TreeItemLabel | undefined;
  children: InternalFullTreeItem[];
};

type InternalApi = {
  getTopLevelFullOutlineItems(): { name: string }[];
  _test_getInternalFullOutlineItems(): InternalFullTreeItem[];
};

function labelText(item: InternalFullTreeItem): string {
  const { label } = item;
  if (label === undefined) return item.displayName;
  return typeof label === "string" ? label : label.label;
}

function findByDisplayName(
  items: InternalFullTreeItem[],
  displayName: string
): InternalFullTreeItem | undefined {
  for (const item of items) {
    if (item.displayName === displayName) return item;
    const found = findByDisplayName(item.children, displayName);
    if (found) return found;
  }
  return undefined;
}

suite("Plan 2.V1 — modifier display config changes rebuild the outline", function () {
  this.timeout(15000);

  let api: InternalApi;
  const config = (): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration("outlinePlus");

  let originalModifierDisplay: unknown;
  let originalDistinctColors: unknown;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!extension) throw new Error("Outline++ extension not found!");
    await extension.activate();
    api = extension.exports as InternalApi;

    originalModifierDisplay = config().get("fullOutlineView.modifierDisplay");
    originalDistinctColors = config().get("fullOutlineView.useDistinctModifierColors");
  });

  suiteTeardown(async () => {
    await config().update(
      "fullOutlineView.modifierDisplay",
      originalModifierDisplay,
      vscode.ConfigurationTarget.Global
    );
    await config().update(
      "fullOutlineView.useDistinctModifierColors",
      originalDistinctColors,
      vscode.ConfigurationTarget.Global
    );
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  });

  test("switching modifierDisplay off removes the private badge without an edit", async () => {
    // Baseline: colorAndBadge → the private `logDetails` method gets a badge prefix.
    await config().update(
      "fullOutlineView.modifierDisplay",
      "colorAndBadge",
      vscode.ConfigurationTarget.Global
    );

    const sampleDocument = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(sampleDocument);

    // Wait until the private symbol shows up WITH a badge prefix (symbols come
    // from the TS language server, so allow warm-up time).
    await waitForCondition(
      () => {
        const item = findByDisplayName(api._test_getInternalFullOutlineItems(), "logDetails");
        return item !== undefined && labelText(item) !== "logDetails";
      },
      8000,
      100
    );

    const badgedItem = findByDisplayName(
      api._test_getInternalFullOutlineItems(),
      "logDetails"
    );
    assert.ok(badgedItem, "Expected a `logDetails` symbol in the outline");
    assert.notStrictEqual(
      labelText(badgedItem),
      "logDetails",
      "Baseline: private member should carry a badge prefix in colorAndBadge mode"
    );

    // Change display mode with NO document edit. Pre-fix: nothing rebuilds and the
    // badge persists; post-fix: the config listener forces a rebuild.
    await config().update(
      "fullOutlineView.modifierDisplay",
      "off",
      vscode.ConfigurationTarget.Global
    );

    await waitForCondition(
      () => {
        const item = findByDisplayName(api._test_getInternalFullOutlineItems(), "logDetails");
        return item !== undefined && labelText(item) === "logDetails";
      },
      5000,
      100
    );

    const plainItem = findByDisplayName(
      api._test_getInternalFullOutlineItems(),
      "logDetails"
    );
    assert.ok(plainItem, "Expected the `logDetails` symbol to still exist");
    assert.strictEqual(
      labelText(plainItem),
      "logDetails",
      "modifierDisplay=off should drop the badge prefix without any document edit"
    );
  });
});
