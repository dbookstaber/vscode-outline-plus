/**
 * VS Code's `TreeView.reveal(item, { expand: N })` expands at most 3 levels of
 * descendants per call, so a single reveal of each top-level item leaves any
 * subtree deeper than 3 levels partially collapsed. To fully expand a tree we
 * reveal an "anchor" item every 3 levels: revealing an anchor at depth D
 * expands depths D..D+3, so anchoring at depths 0, 3, 6, … gives overlapping
 * coverage of the whole tree.
 *
 * Returns the anchor items (those with children, at depths divisible by 3) in
 * shallow-to-deep order, so callers can reveal ancestors before descendants.
 */
export function collectExpandAnchors<T extends { children: T[] }>(items: T[]): T[] {
  const anchors: T[] = [];
  collectInto(items, 0, anchors);
  return anchors;
}

function collectInto<T extends { children: T[] }>(items: T[], depth: number, anchors: T[]): void {
  for (const item of items) {
    if (item.children.length === 0) {
      continue;
    }
    if (depth % 3 === 0) {
      anchors.push(item);
    }
    collectInto(item.children, depth + 1, anchors);
  }
}
