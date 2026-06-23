import type * as vscode from "vscode";
import { type FullTreeItem } from "./FullTreeItem";

/**
 * Finds the most specific (smallest-range) tree item whose range contains the
 * cursor, searching the entire tree rather than stopping at the first match.
 *
 * Regions and symbols can have *crossing* ranges: a region's range runs to its
 * `#endregion` marker, which may extend past the end of the enclosing symbol
 * (e.g. a `# region` marker indented inside a class whose symbol range stops at
 * its last statement). That makes the region and the symbol overlapping
 * siblings that both contain the marker line. A naive "return the first
 * containing sibling, descending once" walk would return the broader symbol and
 * miss the tighter region the user actually clicked. Comparing by range size
 * picks the innermost item the cursor is in, regardless of how the merge nested
 * the crossing ranges.
 */
export function getActiveFullTreeItem(
  fullTreeItems: FullTreeItem[],
  cursorPosition: vscode.Position
): FullTreeItem | undefined {
  let best: FullTreeItem | undefined;
  for (const fullTreeItem of fullTreeItems) {
    if (!fullTreeItem.range.contains(cursorPosition)) {
      continue;
    }
    // A descendant may contain the cursor more tightly than this item does.
    const descendantMatch = getActiveFullTreeItem(fullTreeItem.children, cursorPosition);
    const candidate = descendantMatch ?? fullTreeItem;
    if (best === undefined || isMoreSpecificRange(candidate.range, best.range)) {
      best = candidate;
    }
  }
  return best;
}

/** Whether range `a` is tighter around the cursor than range `b` (fewer lines, then fewer chars). */
function isMoreSpecificRange(a: vscode.Range, b: vscode.Range): boolean {
  const aLineSpan = a.end.line - a.start.line;
  const bLineSpan = b.end.line - b.start.line;
  if (aLineSpan !== bLineSpan) {
    return aLineSpan < bLineSpan;
  }
  const aCharSpan = a.end.character - a.start.character;
  const bCharSpan = b.end.character - b.start.character;
  return aCharSpan < bCharSpan;
}
