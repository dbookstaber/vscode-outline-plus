import * as vscode from "vscode";
import { getExtensionPath } from "../../config/extensionContext";
import { getGlobalFullOutlineViewConfigValue } from "../../config/fullOutlineViewConfig";
import { getRegionDisplayName } from "../../lib/getRegionDisplayInfo";
import { getRegionRange } from "../../lib/getRegionRange";
import {
    createModifierAwareIcon,
    createModifierDescription,
    createModifierLabelPrefix,
    extractSymbolModifiersWithCache,
    getCustomModifierIconPath,
    getDefaultModifiers,
    type ModifierIconConfig,
    type SymbolModifiers,
} from "../../lib/symbolModifiers";
import { type Region } from "../../models/Region";
import { getSymbolThemeIconId } from "../../utils/themeIconUtils";
import { FullTreeItem, type FullTreeItemType, type TreeItemIcon } from "./FullTreeItem";

/**
 * Creates a flattened list of region items for the Full Outline tree view, given a flattened list
 * of regions. Turns each region into a `FullTreeItem` object, with no parent or children yet, since
 * we'll manually add those later when generating the full tree. Gives a unique ID to each item, for
 * the sake of persistent collapsed/selected state (see {@link vscode.TreeItem.id}).
 */
export function getFlattenedRegionFullTreeItems(flattenedRegions: Region[]): FullTreeItem[] {
  const itemCountByPartialId = new Map<string, number>();
  return flattenedRegions.map((region) => {
    const displayName = getRegionDisplayName(region);
    const itemType = "region";
    const partialId = getPartialTreeItemId({ displayName, itemKindId: itemType });
    const newItemCount = (itemCountByPartialId.get(partialId) ?? 0) + 1;
    itemCountByPartialId.set(partialId, newItemCount);
    const id = getUniqueTreeItemId({ partialId, itemCount: newItemCount });
    return getFlattenedFullTreeItem({
      id,
      displayName,
      range: getRegionRange(region),
      itemType,
      icon: new vscode.ThemeIcon("symbol-namespace"),
      modifiers: getDefaultModifiers(),
      modifierDescription: undefined,
    });
  });
}

/**
 * Creates a flattened list of symbol items for the Full Outline tree view, given a flattened
 * list of document symbols. Turns each symbol into a `FullTreeItem` object, with no parent or children yet,
 * since we'll manually add those later when generating the full tree. Gives a unique ID to each item, for
 * the sake of persistent collapsed/selected state (see `vscode.TreeItem.id`).
 *
 * @param flattenedDocumentSymbols The flattened list of document symbols
 * @param document The text document (needed for modifier extraction)
 */
export function getFlattenedSymbolFullTreeItems(
  flattenedDocumentSymbols: vscode.DocumentSymbol[],
  document: vscode.TextDocument | undefined
): FullTreeItem[] {
  const itemCountByPartialId = new Map<string, number>();
  const modifierConfig = getModifierIconConfig();

  return flattenedDocumentSymbols.map((symbol) => {
    const displayName = symbol.name;
    const symbolThemeIconId = getSymbolThemeIconId(symbol.kind);
    const partialId = getPartialTreeItemId({ displayName, itemKindId: symbolThemeIconId });
    const newItemCount = (itemCountByPartialId.get(partialId) ?? 0) + 1;
    itemCountByPartialId.set(partialId, newItemCount);
    const id = getUniqueTreeItemId({ partialId, itemCount: newItemCount });

    // Extract modifiers if enabled and document is available
    const modifiers =
      modifierConfig.showVisibilityColors && document
        ? extractSymbolModifiersWithCache(symbol, document)
        : getDefaultModifiers();

    // Determine icon to use
    let icon: TreeItemIcon;
    
    // Try custom SVG icon first if svgOverlay mode is enabled
    if (modifierConfig.badgePosition === "svgOverlay" && modifierConfig.extensionPath !== undefined) {
      const customIconPath = getCustomModifierIconPath(
        symbolThemeIconId,
        modifiers,
        modifierConfig.extensionPath
      );
      if (customIconPath !== undefined) {
        icon = customIconPath;
      } else {
        // Fall back to theme icon with color for unsupported symbol types
        icon = createModifierAwareIcon(symbolThemeIconId, modifiers, modifierConfig);
      }
    } else {
      // Use standard theme icon with modifier-aware coloring
      icon = createModifierAwareIcon(symbolThemeIconId, modifiers, modifierConfig);
    }

    // Create label prefix if configured for badge position (not used with svgOverlay)
    const modifierLabelPrefix = 
      modifierConfig.badgePosition === "svgOverlay" 
        ? "" 
        : createModifierLabelPrefix(modifiers, modifierConfig);

    // Create description if configured for description position
    const modifierDescription = createModifierDescription(modifiers, modifierConfig);

    return getFlattenedFullTreeItem({
      id,
      displayName: symbol.name,
      range: symbol.range,
      itemType: "symbol",
      icon,
      modifiers,
      modifierLabelPrefix,
      modifierDescription,
    });
  });
}

/**
 * Gets the modifier icon configuration from settings.
 */
function getModifierIconConfig(): ModifierIconConfig {
  const modifierDisplay = getGlobalFullOutlineViewConfigValue("modifierDisplay");
  const useDistinctColors = getGlobalFullOutlineViewConfigValue("useDistinctModifierColors");

  const showVisibilityColors = modifierDisplay !== "off";
  const showStaticIndicator = modifierDisplay !== "off" && modifierDisplay !== "colorOnly";

  // Determine badge position based on modifierDisplay setting
  let badgePosition: "none" | "labelPrefix" | "description" | "svgOverlay" = "none";
  if (modifierDisplay === "colorAndBadge") {
    badgePosition = "labelPrefix";
  } else if (modifierDisplay === "colorAndSvgOverlay") {
    badgePosition = "svgOverlay";
  } else if (modifierDisplay === "colorAndDescription") {
    badgePosition = "description";
  }

  return {
    showVisibilityColors,
    useDistinctColors,
    badgePosition,
    showStaticIndicator,
    extensionPath: getExtensionPath(),
  };
}

/**
 * Generates a partial (potentially non-unique) ID for a tree item, based on its display name and an
 * identifier for the item kind (e.g. "region" or "symbol-boolean").
 */
function getPartialTreeItemId({
  displayName,
  itemKindId,
}: {
  displayName: string;
  itemKindId: string;
}): string {
  return `${itemKindId}-${displayName}`;
}

/**
 * Generates a unique ID for a tree item, based on its partial ID and the number of items so far
 * with that same partial ID. This is used to ensure unique IDs across the tree.
 */
function getUniqueTreeItemId({
  partialId,
  itemCount,
}: {
  partialId: string;
  itemCount: number;
}): string {
  return `${partialId}-${itemCount}`;
}

function getFlattenedFullTreeItem({
  id,
  itemType,
  displayName,
  range,
  icon,
  modifiers,
  modifierLabelPrefix,
  modifierDescription,
}: {
  id: string;
  itemType: FullTreeItemType;
  displayName: string;
  range: vscode.Range;
  icon: TreeItemIcon;
  modifiers: SymbolModifiers;
  modifierLabelPrefix?: string | undefined;
  modifierDescription: string | undefined;
}): FullTreeItem {
  const parent = undefined;
  const children: FullTreeItem[] = [];
  return new FullTreeItem({
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
  });
}
