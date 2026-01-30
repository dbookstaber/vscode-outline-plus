import * as vscode from "vscode";
import { getRangeText } from "../../lib/getRegionDisplayInfo";
import {
  type SymbolModifiers,
  createModifierTooltip,
  getDefaultModifiers,
} from "../../lib/symbolModifiers";
import { makeGoToFullTreeItemCommand } from "./goToFullTreeItem";

export type FullTreeItemType = "region" | "symbol";

export class FullTreeItem extends vscode.TreeItem {
  override id: string;
  displayName: string;
  itemType: FullTreeItemType;
  range: vscode.Range;
  parent: FullTreeItem | undefined;
  children: FullTreeItem[];
  modifiers: SymbolModifiers;

  constructor({
    id,
    displayName,
    range,
    itemType,
    parent,
    children,
    icon,
    modifiers,
    modifierDescription,
  }: {
    id: string;
    displayName: string;
    range: vscode.Range;
    itemType: FullTreeItemType;
    parent: FullTreeItem | undefined;
    children: FullTreeItem[];
    icon: vscode.ThemeIcon | undefined;
    modifiers?: SymbolModifiers | undefined;
    modifierDescription?: string | undefined;
  }) {
    super(displayName, getInitialCollapsibleState(children));
    this.id = id;
    this.displayName = displayName;
    this.itemType = itemType;
    this.modifiers = modifiers ?? getDefaultModifiers();
    this.command = makeGoToFullTreeItemCommand(itemType, range);
    this.parent = parent;
    this.children = children;
    this.range = range;
    if (icon) this.iconPath = icon;

    // Enhanced tooltip with modifier information
    const baseTooltip = `${displayName}: ${getRangeText(range)}`;
    this.tooltip = createModifierTooltip(baseTooltip, this.modifiers);

    // Description appears to the right of the label
    if (modifierDescription !== undefined && modifierDescription !== "") {
      this.description = modifierDescription;
    }
  }
}

function getInitialCollapsibleState(children: FullTreeItem[]): vscode.TreeItemCollapsibleState {
  return children.length > 0
    ? vscode.TreeItemCollapsibleState.Expanded
    : vscode.TreeItemCollapsibleState.None;
}
