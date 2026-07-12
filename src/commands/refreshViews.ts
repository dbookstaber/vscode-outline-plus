import { type OutlinePlusClosuredParams } from "./registerCommand";

export function refreshRegionsView({ regionStore }: OutlinePlusClosuredParams): void {
  regionStore.forceRefresh();
}

export function refreshFullOutlineView({ fullOutlineStore }: OutlinePlusClosuredParams): void {
  fullOutlineStore.forceRefresh();
}
