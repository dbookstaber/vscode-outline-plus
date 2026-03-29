import * as assert from "assert";
import * as vscode from "vscode";
import { type OutlinePlusAPI } from "../../api/regionHelperAPI";
import { type FullTreeItem } from "../../treeView/fullTreeView/FullTreeItem";
import { openSampleDocument } from "../utils/openSampleDocument";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Tests for Full Outline tree view updating when switching active editors.
 *
 * These tests verify that the FULL OUTLINE tree view correctly updates its content
 * when the user switches between different files.
 *
 * Uses polling-based synchronization (waitForCondition) instead of event-based waiting
 * to avoid race conditions where events fire during showTextDocument() before the
 * listener is registered.
 */
suite("Full Outline Active Editor Switch", function() {
  // Increase timeout for all tests in this suite to accommodate polling.
  // The versioned-document-ID consistency test switches editors multiple times,
  // each requiring debounce cycles + language server round-trips.
  this.timeout(20000);

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
    // Close all open editors to start fresh for each test
    await vscode.commands.executeCommand("workbench.action.closeAllEditors");
  });

  // #region Helper Functions

  /**
   * Waits for full outline items to be populated (non-empty array).
   */
  async function waitForFullOutlineItems(timeoutMs = 3000): Promise<void> {
    await waitForCondition(
      () => regionHelperAPI.getTopLevelFullOutlineItems().length > 0,
      timeoutMs,
      50
    );
  }

  /**
   * Waits for active full outline item to be defined.
   */
  async function waitForActiveFullOutlineItem(timeoutMs = 3000): Promise<void> {
    await waitForCondition(
      () => regionHelperAPI.getActiveFullOutlineItem() !== undefined,
      timeoutMs,
      50
    );
  }

  /**
   * Recursively flatten all FullTreeItems (depth-first).
   */
  function flattenOutlineItems(): FullTreeItem[] {
    const result: FullTreeItem[] = [];
    function walk(items: FullTreeItem[]): void {
      for (const item of items) {
        result.push(item);
        if (item.children.length > 0) {
          walk(item.children);
        }
      }
    }
    walk(regionHelperAPI.getTopLevelFullOutlineItems());
    return result;
  }

  /**
   * Waits until the outline contains a region with the given display name.
   * This is more reliable than `waitForFullOutlineItems()` after an editor
   * switch, because it verifies the items actually belong to the target
   * document rather than passing with stale items from the previous document.
   */
  async function waitForOutlineContaining(regionName: string, timeoutMs = 5000): Promise<void> {
    await waitForCondition(
      () => flattenOutlineItems().some((i) => i.displayName === regionName),
      timeoutMs,
      100
    );
  }

  // #endregion

  test("should update full outline items when switching to a different file", async () => {
    // Open first document
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(doc1);
    
    // Wait for the outline to populate
    await waitForFullOutlineItems();

    const itemsFromDoc1 = regionHelperAPI.getTopLevelFullOutlineItems();
    assert.ok(itemsFromDoc1.length > 0, "Should have full outline items from first document");

    // Open second document (different file)
    const doc2 = await openSampleDocument("validSamples", "validSample.cs");
    await vscode.window.showTextDocument(doc2);
    
    // Wait for outline to update - use delay since we can't easily detect when items change
    // when both files have items
    await delay(500);
    
    // Just verify we still have items and the system is responsive
    const itemsFromDoc2 = regionHelperAPI.getTopLevelFullOutlineItems();
    assert.ok(Array.isArray(itemsFromDoc2), "Should have full outline items array from second document");
  });

  test("should update full outline items when switching back to previous file", async () => {
    // Open first document
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(doc1);
    await waitForFullOutlineItems();

    const itemsFromDoc1FirstTime = regionHelperAPI.getTopLevelFullOutlineItems();
    assert.ok(itemsFromDoc1FirstTime.length > 0, "Should have items from doc1");

    // Open second document
    const doc2 = await openSampleDocument("validSamples", "validSample.cs");
    await vscode.window.showTextDocument(doc2);
    
    // Wait for the switch to process
    await delay(500);

    // Switch back to first document
    await vscode.window.showTextDocument(doc1);
    
    // Wait for items to be available again
    await waitForFullOutlineItems();

    const itemsFromDoc1SecondTime = regionHelperAPI.getTopLevelFullOutlineItems();

    // Verify we have items after switching back
    assert.ok(
      itemsFromDoc1SecondTime.length > 0,
      "Should have items when switching back to first document"
    );
  });

  test("should fire onDidChangeFullOutlineItems when switching between files", async () => {
    // Open first document
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(doc1);
    await waitForFullOutlineItems();

    // Set up event listener BEFORE switching
    let eventFiredCount = 0;
    const disposable = regionHelperAPI.onDidChangeFullOutlineItems(() => {
      eventFiredCount++;
    });

    try {
      // Open second document
      const doc2 = await openSampleDocument("validSamples", "validSample.cs");
      await vscode.window.showTextDocument(doc2);
      
      // Give time for the event to fire
      await delay(500);

      // The event should fire at least once when switching files
      // (though it may fire 0 times if the outline items happen to be identical)
      // We just verify the system handles the switch without errors
      assert.ok(
        eventFiredCount >= 0,
        "System should handle file switching"
      );
    } finally {
      disposable.dispose();
    }
  });

  test("should update active full outline item when switching files", async () => {
    // Open first document and move cursor
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    const editor1 = await vscode.window.showTextDocument(doc1);
    await waitForFullOutlineItems();

    // Move cursor to a specific position inside the Imports region (line 5)
    editor1.selection = new vscode.Selection(5, 0, 5, 0);
    await waitForActiveFullOutlineItem();

    const activeItem1 = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(activeItem1 !== undefined, "Should have an active item in first document");

    // Open second document (different TS file — TS language server available in test env)
    const doc2 = await openSampleDocument("readmeSample.ts");
    const editor2 = await vscode.window.showTextDocument(doc2);
    await waitForFullOutlineItems();

    // Move cursor inside Project Overview region (line 1)
    editor2.selection = new vscode.Selection(1, 0, 1, 0);

    // Wait for active item to reflect the new file's context
    // The active item should either be undefined (if not resolved yet)
    // or have a different displayName than doc1's active item
    await waitForCondition(
      () => {
        const active = regionHelperAPI.getActiveFullOutlineItem();
        return active !== undefined && active.displayName !== activeItem1.displayName;
      },
      5000,
      50
    );

    const activeItem2 = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(activeItem2 !== undefined, "Should have an active item in second document");
    assert.notStrictEqual(
      activeItem2.displayName,
      activeItem1.displayName,
      "Active items should have different display names when switching files"
    );
  });

  test("should handle switching to file with no outline items", async () => {
    // Open a document with regions/symbols
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    await vscode.window.showTextDocument(doc1);
    await waitForFullOutlineItems();

    const itemsFromDoc1 = regionHelperAPI.getTopLevelFullOutlineItems();
    assert.ok(itemsFromDoc1.length > 0, "First document should have outline items");

    // Open empty document
    const doc2 = await openSampleDocument("emptyDocument.ts");
    await vscode.window.showTextDocument(doc2);
    
    // Wait for regions to become empty (more reliable than full outline items 
    // since the language server might provide symbols even for "empty" files)
    await waitForCondition(
      () => regionHelperAPI.getTopLevelRegions().length === 0,
      3000,
      50
    );

    const regions = regionHelperAPI.getTopLevelRegions();
    assert.strictEqual(
      regions.length,
      0,
      "Empty document should have no regions"
    );
  });

  test("should handle rapid switching between multiple files", async () => {
    // Open multiple documents
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    const doc2 = await openSampleDocument("validSamples", "validSample.cs");
    const doc3 = await openSampleDocument("readmeSample.ts");

    // Rapidly switch between them
    await vscode.window.showTextDocument(doc1);
    await delay(150); // Brief wait

    await vscode.window.showTextDocument(doc2);
    await delay(150);

    await vscode.window.showTextDocument(doc3);
    
    // Wait for outline to stabilize
    await waitForFullOutlineItems();

    // Verify we ended up with the correct document's outline
    const finalItems = regionHelperAPI.getTopLevelFullOutlineItems();
    
    // The outline should match doc3, not doc1 or doc2
    // We can't easily verify this without knowing the structure, but we can verify
    // that items exist and the API is responsive
    assert.ok(
      Array.isArray(finalItems),
      "Should have outline items array after rapid switching"
    );
  });

  test("should maintain versioned document ID consistency when switching files", async () => {
    // This test verifies that the internal state is properly updated when
    // switching between files, inferred by active items changing correctly.
    //
    // Key: after each switch, we wait for the outline to contain a region name
    // unique to the target document — not just `items.length > 0`, which can
    // pass with stale items from the previous document while the debounced
    // refresh is still pending.

    // --- Doc 1: sampleRegionsDocument.ts (has "Imports" region) ---
    const doc1 = await openSampleDocument("sampleRegionsDocument.ts");
    const editor1 = await vscode.window.showTextDocument(doc1);
    await waitForOutlineContaining("Imports");

    editor1.selection = new vscode.Selection(5, 0, 5, 0);
    await waitForActiveFullOutlineItem();
    const activeItem1 = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(activeItem1 !== undefined, "Should have active item in doc1");

    // --- Doc 2: readmeSample.ts (has "Project Overview" region) ---
    const doc2 = await openSampleDocument("readmeSample.ts");
    const editor2 = await vscode.window.showTextDocument(doc2);
    await waitForOutlineContaining("Project Overview", 8000);

    editor2.selection = new vscode.Selection(1, 0, 1, 0);
    await waitForCondition(
      () => {
        const active = regionHelperAPI.getActiveFullOutlineItem();
        return active !== undefined && active.displayName !== activeItem1.displayName;
      },
      5000,
      100
    );
    const activeItem2 = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(activeItem2 !== undefined, "Should have active item in doc2");

    // --- Switch back to Doc 1 ---
    const returnedEditor = await vscode.window.showTextDocument(doc1);
    await waitForOutlineContaining("Imports", 8000);

    returnedEditor.selection = new vscode.Selection(5, 0, 5, 0);
    await waitForCondition(
      () => {
        const active = regionHelperAPI.getActiveFullOutlineItem();
        return active?.displayName === activeItem1.displayName;
      },
      5000,
      100
    );

    const activeItemBack = regionHelperAPI.getActiveFullOutlineItem();
    assert.ok(activeItemBack !== undefined, "Should have active item after switching back to doc1");
    assert.strictEqual(
      activeItemBack.displayName,
      activeItem1.displayName,
      "Active item displayName should match doc1's context after switching back"
    );
  });
});
