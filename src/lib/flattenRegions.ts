import { type Region } from "../models/Region";

export type FlattenedRegion = Region & {
  flatRegionIdx: number;
  /**
   * Nesting depth: 0 for top-level regions, 1 for their children, and so on.
   * Equal to the number of ancestor regions (see {@link getRegionParents}).
   * Precomputed here during the single flatten traversal so consumers (e.g. the
   * region quick-pick's indentation) don't re-walk each region's parent chain.
   */
  depth: number;
};

/**
 * Flattens a tree of regions, with a `flatRegionIdx` field on each resulting flattened item, and
 * counts the number of parent regions along the way.
 *
 * Note: This function takes O(numRegions) time to run, and is run on `topLevelRegions` at every
 * document change.  Normally, this would be a performance concern, but relatively speaking, a file
 * will have far fewer regions than lines, and we already parse the full document on every change.
 * If there are performance issues with this extension, `parseAllRegions` will likely be the much
 * bigger concern.
 */
export function flattenRegionsAndCountParents(regions: Region[]): {
  flattenedRegions: FlattenedRegion[];
  allParentIds: Set<string>;
} {
  const flattenedRegions: FlattenedRegion[] = [];
  let flatRegionIdx = 0;
  const allParentIds = new Set<string>();

  function traverse(region: Region, depth: number): void {
    const flattenedRegion: FlattenedRegion = { ...region, flatRegionIdx: flatRegionIdx++, depth };
    flattenedRegions.push(flattenedRegion);
    if (region.children.length > 0) {
      allParentIds.add(region.id);
    }
    for (const child of region.children) {
      traverse(child, depth + 1);
    }
  }

  for (const region of regions) {
    traverse(region, 0);
  }

  return { flattenedRegions, allParentIds };
}
