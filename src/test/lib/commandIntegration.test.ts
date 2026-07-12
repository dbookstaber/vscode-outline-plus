import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlineInternalAPI } from "../../api/regionHelperAPI";
import {
    CMD_FULL_OUTLINE_VIEW_EXPAND_ALL,
    CMD_FULL_OUTLINE_VIEW_REFRESH,
    CMD_GO_TO_FULL_TREE_ITEM,
    CMD_GO_TO_NEXT_REGION,
    CMD_GO_TO_PREVIOUS_REGION,
    CMD_GO_TO_REGION_BOUNDARY,
    CMD_REGIONS_VIEW_EXPAND_ALL,
    CMD_REGIONS_VIEW_REFRESH,
    CMD_SELECT_CURRENT_REGION,
} from "../../constants";
import { type Region } from "../../models/Region";
import { openSampleDocument } from "../utils/openSampleDocument";
import { waitForCondition, waitForVoidEvent } from "../utils/waitForEvent";

/**
 * Command-level integration suite (plan 5.1).
 *
 * Drives the *registered* navigation commands via `executeCommand` against the
 * live extension (which closes over the real stores/providers) and asserts the
 * resulting `editor.selection`. Before this suite, zero tests referenced any
 * command file — the commands were only exercised implicitly.
 *
 * The sample document (`sampleRegionsDocument.ts`) parses to 9 regions; the
 * region start lines are read from the live outline API by name so the
 * assertions track the fixture rather than duplicating hard-coded line numbers.
 */
suite("Command integration: navigation commands (plan 5.1)", function () {
  this.timeout(15000);

  let api: OutlineInternalAPI;
  let editor: vscode.TextEditor;

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!extension) {
      throw new Error("Outline++ extension not found!");
    }
    await extension.activate();
    api = extension.exports as OutlineInternalAPI;
  });

  teardown(async () => {
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  /** Opens the sample and waits until the live store has parsed all 9 regions. */
  async function openSampleAndWaitForRegions(): Promise<void> {
    const doc = await openSampleDocument("sampleRegionsDocument.ts");
    editor = await vscode.window.showTextDocument(doc);
    await waitForCondition(() => api.getFlattenedRegions().length === 9, 6000, 50);
  }

  function regionByName(name: string): Region {
    const region = api.getFlattenedRegions().find((r) => r.name === name);
    assert.ok(region, `sample must contain a region named '${name}'`);
    return region;
  }

  /** Expected cursor character after a nav: first non-whitespace column of the target line. */
  function firstNonWhitespaceCol(line: number): number {
    return editor.document.lineAt(line).firstNonWhitespaceCharacterIndex;
  }

  function setCursor(line: number, character = 0): void {
    editor.selection = new vscode.Selection(line, character, line, character);
  }

  test("goToNextRegion moves to the first region below the cursor", async () => {
    await openSampleAndWaitForRegions();
    const imports = regionByName("Imports");
    setCursor(0);

    await vscode.commands.executeCommand(CMD_GO_TO_NEXT_REGION);

    const startLine = imports.range.start.line;
    assert.strictEqual(editor.selection.active.line, startLine, "cursor lands on 'Imports' start");
    assert.strictEqual(editor.selection.active.character, firstNonWhitespaceCol(startLine));
  });

  test("goToNextRegion from a region start advances to the following region", async () => {
    await openSampleAndWaitForRegions();
    const imports = regionByName("Imports");
    const classes = regionByName("Classes");
    setCursor(imports.range.start.line);

    await vscode.commands.executeCommand(CMD_GO_TO_NEXT_REGION);

    assert.strictEqual(
      editor.selection.active.line,
      classes.range.start.line,
      "from 'Imports' start the next region is 'Classes'"
    );
  });

  test("goToPreviousRegion moves to the nearest region above the cursor", async () => {
    await openSampleAndWaitForRegions();
    const classes = regionByName("Classes");
    // Cursor just below the 'Classes' start line; previous region is 'Classes'.
    setCursor(classes.range.start.line + 1);

    await vscode.commands.executeCommand(CMD_GO_TO_PREVIOUS_REGION);

    assert.strictEqual(editor.selection.active.line, classes.range.start.line);
    assert.strictEqual(
      editor.selection.active.character,
      firstNonWhitespaceCol(classes.range.start.line)
    );
  });

  test("goToRegionBoundary toggles from a region's start line to its end line", async () => {
    await openSampleAndWaitForRegions();
    const imports = regionByName("Imports");
    setCursor(imports.range.start.line);
    // goToRegionBoundary reads the store's debounced activeRegion; wait for it.
    await waitForCondition(
      () => api.getActiveRegion()?.range.start.line === imports.range.start.line,
      3000,
      50
    );

    await vscode.commands.executeCommand(CMD_GO_TO_REGION_BOUNDARY);

    assert.strictEqual(
      editor.selection.active.line,
      imports.range.end.line,
      "cursor jumps from the region start to the region end"
    );
  });

  test("selectCurrentRegion selects the enclosing region's full range", async () => {
    await openSampleAndWaitForRegions();
    const imports = regionByName("Imports");
    // Place the cursor inside the Imports region (one line below its start).
    setCursor(imports.range.start.line + 1);

    await vscode.commands.executeCommand(CMD_SELECT_CURRENT_REGION);

    const { selection } = editor;
    assert.strictEqual(selection.start.line, imports.range.start.line, "selection starts at region start");
    assert.strictEqual(selection.end.line, imports.range.end.line, "selection ends at region end");
    assert.ok(!selection.isEmpty, "the region is actually selected");
  });

  test("goToFullTreeItem navigates to the region resolved from its id", async () => {
    await openSampleAndWaitForRegions();
    const methods = regionByName("Methods");

    await vscode.commands.executeCommand(CMD_GO_TO_FULL_TREE_ITEM, methods.id);

    assert.strictEqual(
      editor.selection.active.line,
      methods.range.start.line,
      "the shared go-to command resolves the id to the 'Methods' region"
    );
    assert.strictEqual(
      editor.selection.active.character,
      firstNonWhitespaceCol(methods.range.start.line)
    );
  });

  test("refresh commands re-fire the outline change events without error", async () => {
    await openSampleAndWaitForRegions();

    // forceRefresh always fires onDidChangeRegions; assert the effect, not just absence of throw.
    const regionsFired = waitForVoidEvent(api.onDidChangeRegions, 3000);
    await vscode.commands.executeCommand(CMD_REGIONS_VIEW_REFRESH);
    await regionsFired;

    const outlineFired = waitForVoidEvent(api.onDidChangeFullOutlineItems, 4000);
    await vscode.commands.executeCommand(CMD_FULL_OUTLINE_VIEW_REFRESH);
    await outlineFired;

    // Regions survive the refresh round-trip.
    assert.strictEqual(api.getFlattenedRegions().length, 9);
  });

  test("expand-all commands run without error and leave the outline intact", async () => {
    await openSampleAndWaitForRegions();

    await vscode.commands.executeCommand(CMD_REGIONS_VIEW_EXPAND_ALL);
    await vscode.commands.executeCommand(CMD_FULL_OUTLINE_VIEW_EXPAND_ALL);

    assert.strictEqual(
      api.getFlattenedRegions().length,
      9,
      "expand-all is a view operation and must not disturb the parsed regions"
    );
  });
});
