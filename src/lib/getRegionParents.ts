import { type Region } from "../models/Region";

/**
 * Returns the parents of a region, in order from the top-level parent to the immediate parent.
 */
export function getRegionParents(region: Region): Region[] {
  const parents = [];
  let { parent } = region;
  // Push then reverse: O(n) total vs. O(n²) for repeated unshift on deep nests.
  while (parent) {
    parents.push(parent);
    parent = parent.parent;
  }
  parents.reverse();
  return parents;
}
