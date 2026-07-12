import * as vscode from "vscode";
import { CMD_GO_TO_FULL_TREE_ITEM } from "../../constants";
import { getRangeText } from "../../lib/getRegionDisplayInfo";
import {
    type SymbolModifiers,
    createModifierTooltip,
    getDefaultModifiers,
    getModifierDescription,
} from "../../lib/symbolModifiers";

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
  /** For symbols, the name's range (preferred nav target). Undefined for regions. */
  selectionRange: vscode.Range | undefined;
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
    accessibilityRole,
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
    /**
     * Human-readable role/kind for the screen-reader label (e.g. "method",
     * "region"). Combined with the modifiers and clean display name so the
     * a11y announcement reads "private static method Foo" instead of the visual
     * badge "🔒ˢ Foo".
     */
    accessibilityRole?: string | undefined;
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
    // Resolve the navigation target at click time (looking the item up by id in
    // the live store) rather than baking (line, character) here, so a click on a
    // momentarily-stale tree row still lands on the item's current position
    // (FUTURE_WORK July: "FullTreeItem.command arguments baked at construction").
    this.command = {
      command: CMD_GO_TO_FULL_TREE_ITEM,
      title: "Go to Item",
      arguments: [id],
    };
    this.parent = parent;
    this.children = children;
    this.range = range;
    this.selectionRange = selectionRange;
    if (icon !== undefined) this.iconPath = icon;

    // Accessibility (plan 6.8): screen readers announce (and type-ahead matches)
    // the visible `label`, which leads with the emoji modifier badge (e.g.
    // "🔒ˢ Foo"). Give assistive tech a clean, semantic label instead — the
    // modifiers spelled out, the symbol role, then the unprefixed name — while
    // the visible badge stays exactly as-is.
    this.accessibilityInformation = {
      label: buildAccessibilityLabel(displayName, this.modifiers, accessibilityRole),
    };

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

/**
 * Builds the clean, emoji-free screen-reader label for a Full Outline item:
 * the spelled-out modifiers, an optional role/kind, then the unprefixed display
 * name — e.g. "private static method Foo" or "region Imports". Falls back to the
 * bare display name when no modifiers or role are present. Exported for testing.
 */
export function buildAccessibilityLabel(
  displayName: string,
  modifiers: SymbolModifiers,
  role: string | undefined
): string {
  const modifierText = getModifierDescription(modifiers);
  return [modifierText, role, displayName].filter((part) => part !== undefined && part !== "").join(" ");
}
