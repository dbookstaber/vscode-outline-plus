import * as assert from "assert";
import * as vscode from "vscode";
import {
    getActiveRegionQuickPickItem,
    getRegionQuickPickItemLabel,
    getRegionQuickPickItems,
    previewActiveQuickPickItem,
    restoreEditorViewport,
    shouldPreviewInitialItem,
    type RegionQuickPickItem,
} from "../../commands/goToRegionFromQuickPick";
import { type FlattenedRegion } from "../../lib/flattenRegions";
import { type Region } from "../../models/Region";

/**
 * Unit tests for the pure quick-pick helpers extracted for plan items 2.9 and
 * 2.10. The live QuickPick UI is interactive and cannot be driven headlessly,
 * so the viewport / preview / zero-match logic is exercised through the
 * exported helpers with fake editors that record their side effects.
 */

type DecorationCall = { ranges: readonly vscode.Range[] };
type RevealCall = { range: vscode.Range; revealType: vscode.TextEditorRevealType };

function makeFakeEditor(
  decorationCalls: DecorationCall[],
  revealCalls: RevealCall[],
  selection: vscode.Selection = new vscode.Selection(0, 0, 0, 0)
): vscode.TextEditor {
  return {
    selection,
    setDecorations: (_type: vscode.TextEditorDecorationType, ranges: readonly vscode.Range[]) => {
      decorationCalls.push({ ranges });
    },
    revealRange: (range: vscode.Range, revealType: vscode.TextEditorRevealType) => {
      revealCalls.push({ range, revealType });
    },
  } as unknown as vscode.TextEditor;
}

function makeItem(startLineIdx: number, endLineIdx: number): RegionQuickPickItem {
  return { label: `region@${startLineIdx}`, startLineIdx, endLineIdx };
}

function makeRegionAt(startLine: number): Region {
  return {
    range: new vscode.Range(startLine, 0, startLine + 2, 0),
  } as unknown as Region;
}

function makeFlattenedRegion({
  name,
  startLine,
  endLine,
  depth,
  flatRegionIdx,
}: {
  name: string | undefined;
  startLine: number;
  endLine: number;
  depth: number;
  flatRegionIdx: number;
}): FlattenedRegion {
  return {
    id: `${name ?? "unnamed"}-${flatRegionIdx}`,
    name,
    range: new vscode.Range(startLine, 0, endLine, 0),
    regionIdx: 0,
    wasClosed: true,
    children: [],
    flatRegionIdx,
    depth,
  };
}

suite("goToRegionFromQuickPick helpers (2.9 / 2.10)", () => {
  suite("previewActiveQuickPickItem — zero-match highlight clearing (2.9)", () => {
    test("clears the highlight when the filtered list is empty", () => {
      const decorationCalls: DecorationCall[] = [];
      const fakeEditor = makeFakeEditor(decorationCalls, []);

      previewActiveQuickPickItem({ items: [], activeTextEditor: fakeEditor });

      assert.strictEqual(
        decorationCalls.length,
        1,
        "setDecorations must be called to clear the stale highlight"
      );
      assert.strictEqual(
        decorationCalls[0]?.ranges.length,
        0,
        "the highlight must be cleared with an empty range set"
      );
    });

    test("highlights and scrolls to the active item when the list is non-empty", () => {
      const decorationCalls: DecorationCall[] = [];
      const revealCalls: RevealCall[] = [];
      const fakeEditor = makeFakeEditor(decorationCalls, revealCalls);

      previewActiveQuickPickItem({ items: [makeItem(3, 7)], activeTextEditor: fakeEditor });

      assert.strictEqual(decorationCalls.length, 1, "a highlight decoration is applied");
      assert.ok((decorationCalls[0]?.ranges.length ?? 0) > 0, "a non-empty range is highlighted");
      assert.strictEqual(revealCalls.length, 1, "the region is scrolled into view");
    });
  });

  suite("shouldPreviewInitialItem — no jump when cursor is outside regions (2.10 ii)", () => {
    test("is false when there is no active region", () => {
      assert.strictEqual(
        shouldPreviewInitialItem({ activeRegion: undefined, initialActiveItem: makeItem(0, 1) }),
        false
      );
    });

    test("is true when the cursor is inside a region", () => {
      assert.strictEqual(
        shouldPreviewInitialItem({ activeRegion: makeRegionAt(3), initialActiveItem: makeItem(3, 7) }),
        true
      );
    });

    test("is false when there is no initial item even with an active region", () => {
      assert.strictEqual(
        shouldPreviewInitialItem({ activeRegion: makeRegionAt(3), initialActiveItem: undefined }),
        false
      );
    });

    test("getActiveRegionQuickPickItem still defaults to the first item when no active region", () => {
      const items = [makeItem(2, 4), makeItem(6, 8)];
      const result = getActiveRegionQuickPickItem({
        activeRegion: undefined,
        regionQuickPickItems: items,
      });
      // Selection is unchanged (first item); only the preview-scroll is skipped.
      assert.strictEqual(result, items[0]);
    });
  });

  suite("getRegionQuickPickItemLabel — indentation rendering (plan 4.6)", () => {
    test("top-level region (depth 0) has no indentation", () => {
      const label = getRegionQuickPickItemLabel(
        makeFlattenedRegion({ name: "Imports", startLine: 4, endLine: 7, depth: 0, flatRegionIdx: 0 })
      );
      assert.strictEqual(label, "Imports");
    });

    test("nested regions are indented two spaces per depth level", () => {
      const depth1 = getRegionQuickPickItemLabel(
        makeFlattenedRegion({ name: "Methods", startLine: 23, endLine: 37, depth: 1, flatRegionIdx: 3 })
      );
      const depth2 = getRegionQuickPickItemLabel(
        makeFlattenedRegion({ name: "Nested", startLine: 32, endLine: 36, depth: 2, flatRegionIdx: 4 })
      );
      assert.strictEqual(depth1, "  Methods");
      assert.strictEqual(depth2, "    Nested");
    });

    test("an unnamed region renders the placeholder display name", () => {
      const label = getRegionQuickPickItemLabel(
        makeFlattenedRegion({ name: undefined, startLine: 65, endLine: 68, depth: 0, flatRegionIdx: 8 })
      );
      assert.strictEqual(label, "Unnamed region");
    });
  });

  suite("getRegionQuickPickItems — items building from flattenedRegions (plan 4.6)", () => {
    // Mirrors the sampleRegionsDocument hierarchy: two top-level regions, the
    // second with a nested child. Order is depth-first pre-order (as the store's
    // flattenedRegions already are).
    const flattenedRegions: FlattenedRegion[] = [
      makeFlattenedRegion({ name: "Imports", startLine: 4, endLine: 7, depth: 0, flatRegionIdx: 0 }),
      makeFlattenedRegion({ name: "Classes", startLine: 9, endLine: 58, depth: 0, flatRegionIdx: 1 }),
      makeFlattenedRegion({ name: "Methods", startLine: 23, endLine: 37, depth: 1, flatRegionIdx: 2 }),
    ];

    test("produces exactly one item per flattened region, preserving order", () => {
      const items = getRegionQuickPickItems(flattenedRegions);
      assert.strictEqual(items.length, 3);
      assert.deepStrictEqual(
        items.map((item) => item.label),
        ["Imports", "Classes", "  Methods"]
      );
    });

    test("carries each region's start/end line indices onto the item", () => {
      const items = getRegionQuickPickItems(flattenedRegions);
      assert.deepStrictEqual(
        items.map((item) => [item.startLineIdx, item.endLineIdx]),
        [
          [4, 7],
          [9, 58],
          [23, 37],
        ]
      );
    });

    test("renders a 1-based line-range description per item", () => {
      const items = getRegionQuickPickItems(flattenedRegions);
      assert.strictEqual(items[0]?.description, "Lines 5 to 8");
      assert.strictEqual(items[2]?.description, "Lines 24 to 38");
    });

    test("returns an empty list when there are no regions", () => {
      assert.deepStrictEqual(getRegionQuickPickItems([]), []);
    });
  });

  suite("getActiveRegionQuickPickItem — active-item selection (plan 4.6)", () => {
    const items = [makeItem(4, 7), makeItem(9, 58), makeItem(23, 37)];

    test("selects the item whose start line matches the active region", () => {
      const result = getActiveRegionQuickPickItem({
        activeRegion: makeRegionAt(23),
        regionQuickPickItems: items,
      });
      assert.strictEqual(result, items[2]);
    });

    test("returns undefined when the active region matches no item's start line", () => {
      const result = getActiveRegionQuickPickItem({
        activeRegion: makeRegionAt(99),
        regionQuickPickItems: items,
      });
      assert.strictEqual(result, undefined);
    });
  });

  suite("restoreEditorViewport — Escape restores the pre-open viewport (2.10 i)", () => {
    test("reveals the captured pre-open visible range", () => {
      const revealCalls: RevealCall[] = [];
      const fakeEditor = makeFakeEditor([], revealCalls);
      const originalVisibleRange = new vscode.Range(10, 0, 20, 0);

      restoreEditorViewport({ activeTextEditor: fakeEditor, originalVisibleRange });

      assert.strictEqual(revealCalls.length, 1, "the viewport is restored via revealRange");
      assert.strictEqual(
        revealCalls[0]?.range.isEqual(originalVisibleRange),
        true,
        "the exact captured range is revealed, not the current cursor line"
      );
    });

    test("falls back to the current line when no viewport was captured", () => {
      const revealCalls: RevealCall[] = [];
      const fakeEditor = makeFakeEditor([], revealCalls, new vscode.Selection(5, 0, 5, 0));

      restoreEditorViewport({ activeTextEditor: fakeEditor, originalVisibleRange: undefined });

      assert.strictEqual(revealCalls.length, 1);
      assert.strictEqual(
        revealCalls[0]?.range.start.line,
        5,
        "with no captured viewport it recenters on the cursor line"
      );
    });
  });
});
