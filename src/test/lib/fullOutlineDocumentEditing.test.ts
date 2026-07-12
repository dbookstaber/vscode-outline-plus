import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlineInternalAPI, type OutlineItem } from "../../api/regionHelperAPI";
import { DEBOUNCE_DOCUMENT_PARSE_MS, DEBOUNCE_FULL_OUTLINE_PAIRING_MS } from "../../constants";
import { openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

// The full-outline refresh chain is the RegionStore parse debounce followed by
// FullOutlineStore's short pairing debounce (plan 4.3: the latter is no longer a
// second full parse debounce). Derive the settle window from both constants plus
// a margin so any spurious event would have fired before we assert it did not.
const FULL_OUTLINE_SETTLE_MS =
  DEBOUNCE_DOCUMENT_PARSE_MS + DEBOUNCE_FULL_OUTLINE_PAIRING_MS + 250;

/**
 * Tests for Full Outline tree view updating when editing documents.
 *
 * These tests verify that the FULL OUTLINE tree view correctly updates its content
 * when the user edits the active document.
 *
 * Uses polling-based synchronization (waitForCondition) instead of event-based waiting
 * to avoid race conditions where events fire during edit operations before the
 * listener is registered.
 */
suite("Full Outline Document Editing", function() {
  // Increase timeout for all tests in this suite to accommodate polling
  this.timeout(10000);

  let regionHelperAPI: OutlineInternalAPI;
  let editor: vscode.TextEditor;

  suiteSetup(async () => {
    const regionHelperExtension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    if (!regionHelperExtension) {
      throw new Error("Outline++ extension not found!");
    }
    await regionHelperExtension.activate();
    regionHelperAPI = regionHelperExtension.exports as OutlineInternalAPI;
  });

  setup(async () => {
    // Open a fresh sample document for each test
    const sampleDocument = await openSampleDocument("sampleRegionsDocument.ts");
    editor = await vscode.window.showTextDocument(sampleDocument);

    // Wait for initial full outline to be populated using polling
    await waitForCondition(
      () => regionHelperAPI.getTopLevelFullOutlineItems().length > 0,
      3000,
      50
    );
  });

  teardown(async () => {
    // Plan 5.9: REVERT then close. Plain closeActiveEditor discards the tab but
    // leaves the underlying (dirty) TextDocument buffer intact for a tick, so an
    // in-flight debounced refresh — or the next test reopening the same sample —
    // could observe this test's edits. revertAndCloseActiveEditor restores the
    // on-disk content first, killing that cross-test bleed.
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  });

  // #region Helper Functions

  async function insertTextAtPosition(
    text: string,
    line: number,
    character: number
  ): Promise<void> {
    const position = new vscode.Position(line, character);
    await editor.edit((editBuilder) => {
      editBuilder.insert(position, text);
    });
  }

  async function deleteLineRange(startLine: number, endLine: number): Promise<void> {
    const range = new vscode.Range(startLine, 0, endLine + 1, 0);
    await editor.edit((editBuilder) => {
      editBuilder.delete(range);
    });
  }

  async function replaceTextAtLine(line: number, newText: string): Promise<void> {
    const lineObj = editor.document.lineAt(line);
    await editor.edit((editBuilder) => {
      editBuilder.replace(lineObj.range, newText);
    });
  }

  /** Depth-first flatten of the full outline items (regions + symbols). */
  function flattenOutlineItems(): OutlineItem[] {
    const result: OutlineItem[] = [];
    function walk(items: readonly OutlineItem[]): void {
      for (const item of items) {
        result.push(item);
        walk(item.children);
      }
    }
    walk(regionHelperAPI.getTopLevelFullOutlineItems());
    return result;
  }

  // #endregion

  test("should update full outline items when a new region is added", async () => {
    // Precondition: the new region is not present before the edit.
    assert.ok(
      !flattenOutlineItems().some((i) => i.name === "UniqueNewTestRegion123"),
      "Sanity: the unique region must not exist before it is inserted"
    );

    // Add a new region with a unique name
    await insertTextAtPosition("// #region UniqueNewTestRegion123\n// content\n// #endregion\n", 0, 0);

    // Wait for the FULL OUTLINE (not just the region store) to contain the new
    // region item — this is the view the test title claims to exercise.
    await waitForCondition(
      () => flattenOutlineItems().some((i) => i.kind === "region" && i.name === "UniqueNewTestRegion123"),
      3000,
      50
    );

    const newItem = flattenOutlineItems().find(
      (i) => i.kind === "region" && i.name === "UniqueNewTestRegion123"
    );
    assert.ok(newItem !== undefined, "Full outline should contain the newly added region item");
  });

  test("should update full outline items when a region is deleted", async () => {
    // Precondition: the full outline contains the "Imports" region item.
    assert.ok(
      flattenOutlineItems().some((i) => i.kind === "region" && i.name === "Imports"),
      "Sanity: the full outline should contain the 'Imports' region before deletion"
    );

    // Delete the Imports region (lines 4-7 in sampleRegionsDocument.ts)
    await deleteLineRange(4, 7);

    // Wait for the FULL OUTLINE to drop the deleted region item.
    await waitForCondition(
      () => !flattenOutlineItems().some((i) => i.kind === "region" && i.name === "Imports"),
      3000,
      50
    );

    assert.ok(
      !flattenOutlineItems().some((i) => i.kind === "region" && i.name === "Imports"),
      "Full outline should no longer contain the deleted 'Imports' region"
    );
  });

  test("should update full outline items when a region name changes", async () => {
    // Change the region name (line 4: // #region Imports -> // #region RenamedRegion)
    await replaceTextAtLine(4, "// #region RenamedRegion");

    // Wait for the renamed item to appear in the outline
    await waitForCondition(
      () => {
        const items = regionHelperAPI.getTopLevelFullOutlineItems();
        return items.some(item => item.name.includes("RenamedRegion"));
      },
      3000,
      50
    );

    const updatedItems = regionHelperAPI.getTopLevelFullOutlineItems();

    // Verify the name changed
    const foundRenamedItem = updatedItems.some(item => item.name.includes("RenamedRegion"));

    assert.ok(foundRenamedItem, "Full outline should reflect the renamed region");
  });

  test("should update when document symbols change (e.g., new function added)", async () => {
    // Precondition: the new symbol is not present before the edit.
    assert.ok(
      !flattenOutlineItems().some((i) => i.kind === "symbol" && i.name === "newTestFunction"),
      "Sanity: 'newTestFunction' must not exist before it is added"
    );

    // Add a new function to the document (TS language server is available in the
    // test host, so this must surface as a symbol item in the outline).
    await insertTextAtPosition(
      "\nfunction newTestFunction() {\n  return true;\n}\n",
      editor.document.lineCount,
      0
    );

    // Wait for the newly added function to appear as a symbol in the full outline.
    await waitForCondition(
      () => flattenOutlineItems().some((i) => i.kind === "symbol" && i.name === "newTestFunction"),
      5000,
      50
    );

    assert.ok(
      flattenOutlineItems().some((i) => i.kind === "symbol" && i.name === "newTestFunction"),
      "Full outline should contain the newly added function symbol"
    );
  });

  test("should handle rapid successive edits correctly", async () => {
    let eventCount = 0;
    const disposable = regionHelperAPI.onDidChangeFullOutlineItems(() => {
      eventCount++;
    });

    try {
      // Make several rapid edits
      await insertTextAtPosition("// Comment 1\n", 0, 0);
      await insertTextAtPosition("// Comment 2\n", 0, 0);
      await insertTextAtPosition("// Comment 3\n", 0, 0);

      // Wait for the debounced refresh chain to fire. The chain is RegionStore
      // debounce (250ms) → FullOutlineStore pairing debounce (50ms; plan 4.3)
      // ≈ 300ms minimum after the last edit. Use polling so the test isn't
      // dependent on exact timing — earlier flakiness here came from a fixed
      // 400ms delay that finished BEFORE the post-edit refresh actually ran.
      try {
        await waitForCondition(() => eventCount >= 1, 2000, 50);
      } catch {
        // Fall through to assertion for a clearer failure message.
      }

      // Events should fire (debounced, so possibly fewer than 3)
      assert.ok(eventCount >= 1, "Full outline should update after rapid edits");
    } finally {
      disposable.dispose();
    }
  });

  test("should update active item when cursor moves after editing", async () => {
    // Add a new region at the top
    await insertTextAtPosition("// #region Top Region\n// content\n// #endregion\n", 0, 0);
    
    // Wait for the new region to appear
    await waitForCondition(
      () => {
        const items = regionHelperAPI.getTopLevelFullOutlineItems();
        return items.some(item => item.name.includes("Top Region"));
      },
      3000,
      50
    );

    // Move cursor to the new region
    editor.selection = new vscode.Selection(1, 0, 1, 0);
    
    // Wait for active item to be defined
    await waitForCondition(
      () => regionHelperAPI.getActiveFullOutlineItem() !== undefined,
      3000,
      50
    );

    const activeItem = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(
      activeItem !== undefined,
      "Should have an active item after moving cursor to new region"
    );
  });

  test("should handle editing that affects region boundaries", async () => {
    // The clean sample's top-level regions that must survive a boundary shift.
    const coreRegions = ["Imports", "Classes", "Type Definitions"];
    const hasAllCoreRegions = (): boolean => {
      const names = new Set(
        flattenOutlineItems()
          .filter((i) => i.kind === "region")
          .map((i) => i.name)
      );
      return coreRegions.every((name) => names.has(name));
    };

    assert.ok(hasAllCoreRegions(), "Sanity: outline should contain the sample's core regions before the edit");

    // Insert 3 comment lines at the beginning, shifting every region down. This
    // changes region positions but not the region structure, so the outline
    // must continue to expose the sample's regions (edit handled gracefully,
    // no regions dropped or corrupted).
    //
    // We assert on presence of the known core regions rather than exact set
    // equality: this suite does not revert edits between tests, so a stale
    // debounced refresh from a prior test can transiently inject an extra
    // region name. Requiring the core regions to be present is robust to that
    // while still failing if the boundary edit drops or corrupts them.
    await insertTextAtPosition("// Line 1\n// Line 2\n// Line 3\n", 0, 0);

    await waitForCondition(hasAllCoreRegions, 6000, 50);
    assert.ok(
      hasAllCoreRegions(),
      "The full outline should still contain the sample's core regions after a boundary-shifting edit"
    );
  });

  test("should NOT fire outline events when editing a comment inside a region", async () => {
    // Line 5 (0-indexed) is a comment line inside the Imports region — editing
    // it changes neither the region structure nor any document symbol, so the
    // full outline must not change and no event should fire.

    // Let any in-flight refresh from setup() settle before we start counting.
    await delay(FULL_OUTLINE_SETTLE_MS);

    const namesBefore = flattenOutlineItems().map((i) => i.name);

    let eventCount = 0;
    const disposable = regionHelperAPI.onDidChangeFullOutlineItems(() => {
      eventCount++;
    });

    try {
      await replaceTextAtLine(5, "// Modified comment inside region");

      // Wait for the edit to land, then past the full-outline debounce so any
      // spurious event would already have fired.
      await waitForCondition(
        () => editor.document.lineAt(5).text.includes("Modified comment"),
        2000,
        25
      );
      await delay(FULL_OUTLINE_SETTLE_MS);

      assert.strictEqual(
        eventCount,
        0,
        "onDidChangeFullOutlineItems should not fire for a comment edit inside a region"
      );

      const namesAfter = flattenOutlineItems().map((i) => i.name);
      assert.deepStrictEqual(
        namesAfter,
        namesBefore,
        "Full outline structure should be unchanged by a comment edit inside a region"
      );
    } finally {
      disposable.dispose();
    }
  });

  test("should handle deletion of all content gracefully", async () => {
    // Delete all content in the document
    const fullRange = new vscode.Range(
      0,
      0,
      editor.document.lineCount - 1,
      editor.document.lineAt(editor.document.lineCount - 1).text.length
    );
    await editor.edit((editBuilder) => {
      editBuilder.delete(fullRange);
    });

    // Wait for regions to become empty (more reliable than full outline items
    // since full outline depends on both regions AND document symbols)
    await waitForCondition(
      () => regionHelperAPI.getTopLevelRegions().length === 0,
      3000,
      50
    );

    // Verify regions are empty (full outline may still have document symbols from language server
    // so we check the more reliable regions API)
    const regions = regionHelperAPI.getTopLevelRegions();
    assert.strictEqual(
      regions.length,
      0,
      "Regions should be empty after deleting all content"
    );
  });

  test("should update when mixing region and symbol changes", async () => {
    const initialRegionCount = regionHelperAPI.getTopLevelRegions().length;

    // Add both a region and a function
    await insertTextAtPosition(
      "// #region Mixed Region\nfunction mixedFunction() {}\n// #endregion\n",
      0,
      0
    );

    // Wait for the region count to increase
    await waitForCondition(
      () => regionHelperAPI.getTopLevelRegions().length > initialRegionCount,
      3000,
      50
    );

    const updatedRegions = regionHelperAPI.getTopLevelRegions();
    assert.ok(
      updatedRegions.length > initialRegionCount,
      "Should have more regions after adding a region"
    );
    const newRegion = updatedRegions.find(region => region.name === "Mixed Region");
    assert.ok(newRegion !== undefined, "Should find the newly added Mixed Region");
  });
});
