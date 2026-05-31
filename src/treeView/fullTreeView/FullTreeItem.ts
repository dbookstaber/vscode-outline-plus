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
    selectionRange,
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
    /** For symbols, the name's range (preferred for goto). Undefined for regions. */
    selectionRange?: vscode.Range | undefined;
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
    // Initial collapsible state is always overridden later by generateFullOutlineTreeItems
    // (which resets to None then sets parent states) and by FullTreeViewProvider.getTreeItem.
    super(label, vscode.TreeItemCollapsibleState.None);
    this.id = id;
    this.displayName = displayName;
    this.itemType = itemType;
    this.modifiers = modifiers ?? getDefaultModifiers();
    this.command = makeGoToFullTreeItemCommand(itemType, range, selectionRange);
    this.parent = parent;
    this.children = children;
    this.range = range;
    if (icon !== undefined) this.iconPath = icon;

    // Description appears to the right of the label
    if (modifierDescription !== undefined && modifierDescription !== "") {
      this.description = modifierDescription;
    }

    // Lazy tooltip: VS Code reads tooltip on hover; createModifierTooltip
    // builds a MarkdownString — wasted work for items never hovered.
    // Defined as an own-property accessor via defineProperty since TS forbids
    // overriding the base class's `tooltip` data property with an accessor.
    const resolvedModifiers = this.modifiers;
    let cachedTooltip: string | vscode.MarkdownString | undefined;
    Object.defineProperty(this, "tooltip", {
      configurable: true,
      enumerable: true,
      get(): string | vscode.MarkdownString {
        if (cachedTooltip === undefined) {
          const baseTooltip = `${displayName}: ${getRangeText(range)}`;
          cachedTooltip = createModifierTooltip(baseTooltip, resolvedModifiers);
        }
        return cachedTooltip;
      },
      set(value: string | vscode.MarkdownString | undefined) {
        cachedTooltip = value;
      },
    });
  }
}
