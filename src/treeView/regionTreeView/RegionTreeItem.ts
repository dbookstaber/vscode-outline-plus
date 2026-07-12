import * as vscode from "vscode";
import { CMD_GO_TO_FULL_TREE_ITEM } from "../../constants";
import { getRegionDisplayName, getRegionRangeText } from "../../lib/getRegionDisplayInfo";
import { scopeTreeItemIdToDocument } from "../../lib/getVersionedDocumentId";
import { type Region } from "../../models/Region";

export class RegionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly region: Region,
    initialCollapsibleState: vscode.TreeItemCollapsibleState,
    documentId: string | undefined
  ) {
    const displayName = getRegionDisplayName(region);
    super(displayName, initialCollapsibleState);
    // Scope the VS Code-facing id to the document so its expansion memory does
    // not bleed between two files with a same-named region (plan D-5). The
    // command argument stays the unscoped region.id, which is how the region is
    // keyed in RegionStore (where the shared command resolves it at click time).
    this.id = scopeTreeItemIdToDocument(documentId, region.id);
    this.command = {
      command: CMD_GO_TO_FULL_TREE_ITEM,
      title: "Go to Region",
      arguments: [region.id],
    };
    this.iconPath = new vscode.ThemeIcon("symbol-namespace");

    // Accessibility (plan 6.8): give screen readers a role-qualified label
    // ("region Imports") rather than just the bare name. Region rows carry no
    // emoji badge, so the visible label is already clean; this only adds the
    // "region" role for a clearer announcement.
    this.accessibilityInformation = { label: `region ${displayName}` };

    // Lazy tooltip: VS Code reads tooltip on hover, so defer the string
    // construction (saves work for items never hovered). Defined as an
    // own-property accessor via defineProperty since TS forbids overriding
    // the base class's `tooltip` data property with an accessor.
    let cachedTooltip: string | undefined;
    Object.defineProperty(this, "tooltip", {
      configurable: true,
      enumerable: true,
      get(): string {
        return (cachedTooltip ??= `${displayName}: ${getRegionRangeText(region)}`);
      },
      set(value: string | undefined) {
        cachedTooltip = value;
      },
    });
  }
}
