import * as vscode from "vscode";
import { getRangeText } from "../../lib/getRegionDisplayInfo";
import {
    type SymbolModifiers,
    createModifierTooltip,
    getDefaultModifiers,
} from "../../lib/symbolModifiers";
import { makeGoToFullTreeItemCommand } from "./goToFullTreeItem";

export type FullTreeItemType = "region" | "symbol";

/** Icon type that can be either a ThemeIcon or a path to custom SVG icons */
export type TreeItemIcon =
  | vscode.ThemeIcon
  | { light: vscode.Uri; dark: vscode.Uri }
  | undefined;

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
    modifierLabelPrefix,
    modifierDescription,
  }: {
    id: string;
    displayName: string;
    range: vscode.Range;
    itemType: FullTreeItemType;
    parent: FullTreeItem | undefined;
    children: FullTreeItem[];
    icon: TreeItemIcon;
    modifiers?: SymbolModifiers | undefined;
    /** Badge prefix to prepend to label (e.g., "🔒ˢ ") */
    modifierLabelPrefix?: string | undefined;
    modifierDescription?: string | undefined;
  }) {
    // Apply label prefix if provided (non-empty string)
    const label =
      modifierLabelPrefix !== undefined && modifierLabelPrefix !== ""
        ? modifierLabelPrefix + displayName
        : displayName;
    super(label, getInitialCollapsibleState(children));
    this.id = id;
    this.displayName = displayName;
    this.itemType = itemType;
    this.modifiers = modifiers ?? getDefaultModifiers();
    this.command = makeGoToFullTreeItemCommand(itemType, range);
    this.parent = parent;
    this.children = children;
    this.range = range;
    if (icon !== undefined) this.iconPath = icon;

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
