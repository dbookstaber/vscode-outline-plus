import { type OutlinePlusClosuredParams } from "./registerCommand";

export function expandAllRegionTreeItems({
  regionTreeViewProvider,
}: OutlinePlusClosuredParams): void {
  void regionTreeViewProvider.expandAllTreeItems();
}

export function expandAllFullOutlineItems({
  fullTreeViewProvider,
}: OutlinePlusClosuredParams): void {
  void fullTreeViewProvider.expandAllTreeItems();
}
