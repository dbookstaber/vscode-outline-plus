import * as vscode from "vscode";
import { getRegionDisplayName, getRegionRangeText } from "../../lib/getRegionDisplayInfo";
import { type Region } from "../../models/Region";
import { goToRegionTreeItemCommand } from "./goToRegionTreeItem";

export class RegionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly region: Region,
    initialCollapsibleState: vscode.TreeItemCollapsibleState
  ) {
    const displayName = getRegionDisplayName(region);
    super(displayName, initialCollapsibleState);
    this.id = region.id;
    this.command = {
      command: goToRegionTreeItemCommand.id,
      title: "Go to Region",
      arguments: [region.range.start.line],
    };
    this.iconPath = new vscode.ThemeIcon("symbol-namespace");

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
