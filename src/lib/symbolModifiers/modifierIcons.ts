import * as path from "path";
import * as vscode from "vscode";
import {
    getModifierDescription,
    hasAnyModifier,
    type SymbolModifiers,
    type VisibilityModifier,
} from "./SymbolModifiers";

/**
 * Theme color IDs for visibility modifiers.
 * These reference VS Code's built-in theme colors for consistency.
 */
const VISIBILITY_COLORS: Record<VisibilityModifier, string | undefined> = {
  public: "symbolIcon.methodForeground", // Use method color (typically green/cyan)
  private: "symbolIcon.fieldForeground", // Use field color (typically more muted)
  protected: "symbolIcon.propertyForeground", // Use property color
  internal: "symbolIcon.moduleForeground", // Use module color
  "protected-internal": "symbolIcon.propertyForeground",
  "private-protected": "symbolIcon.fieldForeground",
  package: "symbolIcon.moduleForeground",
  default: undefined, // No color override - use default icon color
};

/**
 * Alternative simpler color scheme using chart/debug colors that are more distinct.
 */
const VISIBILITY_COLORS_DISTINCT: Record<VisibilityModifier, string | undefined> = {
  public: "charts.green", // Green = public/accessible
  private: "charts.red", // Red = private/inaccessible
  protected: "charts.yellow", // Yellow = protected/limited
  internal: "charts.blue", // Blue = internal
  "protected-internal": "charts.orange",
  "private-protected": "charts.purple",
  package: "charts.blue",
  default: undefined,
};

/**
 * Configuration for how modifier icons should be rendered.
 */
export type ModifierIconConfig = {
  /** Whether to show visibility color hints */
  showVisibilityColors: boolean;
  /** Whether to use distinct (chart) colors vs symbol-based colors */
  useDistinctColors: boolean;
  /** Where to show badge symbols: "none", "labelPrefix", "description", or "svgOverlay" */
  badgePosition: "none" | "labelPrefix" | "description" | "svgOverlay";
  /** Whether to add static indicator */
  showStaticIndicator: boolean;
  /** Extension path for loading custom icons (required for svgOverlay mode) */
  extensionPath?: string | undefined;
};

/**
 * Get default modifier icon configuration.
 */
export function getDefaultModifierIconConfig(): ModifierIconConfig {
  return {
    showVisibilityColors: true,
    useDistinctColors: true,
    badgePosition: "labelPrefix", // Show badges as label prefix (closest to icon)
    showStaticIndicator: true,
  };
}

/**
 * Symbol types that have custom SVG icons with overlays.
 */
const SUPPORTED_CUSTOM_ICON_TYPES = new Set(["symbol-method", "symbol-property", "symbol-field"]);

/**
 * Map from symbol icon ID to custom icon base name.
 */
const CUSTOM_ICON_BASE_NAMES: Record<string, string> = {
  "symbol-method": "method",
  "symbol-property": "property",
  "symbol-field": "field",
};

/**
 * Gets the custom SVG icon path for a symbol with modifiers.
 * Returns undefined if no custom icon is available for this combination.
 *
 * @param baseIconId The base symbol icon ID (e.g., "symbol-method")
 * @param modifiers The symbol's modifiers
 * @param extensionPath Path to the extension directory
 * @returns Icon path object for light/dark themes, or undefined
 */
export function getCustomModifierIconPath(
  baseIconId: string,
  modifiers: SymbolModifiers,
  extensionPath: string
): { light: vscode.Uri; dark: vscode.Uri } | undefined {
  // Check if we have custom icons for this symbol type
  if (!SUPPORTED_CUSTOM_ICON_TYPES.has(baseIconId)) {
    return undefined;
  }

  const baseName = CUSTOM_ICON_BASE_NAMES[baseIconId];
  if (baseName === undefined) {
    return undefined;
  }

  // Determine which icon variant to use based on modifiers
  const parts: string[] = [baseName];

  // Add visibility suffix
  switch (modifiers.visibility) {
    case "private":
    case "private-protected":
      parts.push("private");
      break;
    case "protected":
    case "protected-internal":
      parts.push("protected");
      break;
    // public and internal use base icon (or just static variant)
    default:
      // Only proceed if there's a static modifier
      if (!modifiers.memberModifiers.isStatic) {
        return undefined; // No custom icon for plain public
      }
      break;
  }

  // Add static suffix
  if (modifiers.memberModifiers.isStatic) {
    parts.push("static");
  }

  // Build icon filename
  const iconName = parts.join("-") + ".svg";
  if (!/^[a-z-]+\.svg$/.test(iconName)) {
    return undefined;
  }
  const iconPath = path.join(extensionPath, "assets", "icons", iconName);
  const iconUri = vscode.Uri.file(iconPath);

  // Use same icon for both light and dark themes (icons are designed to work in both)
  return { light: iconUri, dark: iconUri };
}

/**
 * Creates a ThemeIcon with color based on symbol modifiers.
 *
 * @param baseIconId The base icon ID (e.g., "symbol-method")
 * @param modifiers The symbol's modifiers
 * @param config The icon configuration
 * @returns A ThemeIcon with appropriate color, or undefined if no valid icon
 */
export function createModifierAwareIcon(
  baseIconId: string,
  modifiers: SymbolModifiers,
  config: ModifierIconConfig
): vscode.ThemeIcon | undefined {
  // If no modifiers and no special config, return base icon
  if (!hasAnyModifier(modifiers) && !config.showVisibilityColors) {
    return new vscode.ThemeIcon(baseIconId);
  }

  // Determine the color to use
  let colorId: string | undefined;

  if (config.showVisibilityColors && modifiers.visibility !== "default") {
    const colorMap = config.useDistinctColors ? VISIBILITY_COLORS_DISTINCT : VISIBILITY_COLORS;
    colorId = colorMap[modifiers.visibility];
  }

  // For static members, we could use a modified icon ID if VS Code supported it
  // For now, we use color and tooltip to convey static status

  if (colorId !== undefined && colorId !== "") {
    return new vscode.ThemeIcon(baseIconId, new vscode.ThemeColor(colorId));
  }

  return new vscode.ThemeIcon(baseIconId);
}

/**
 * Get a visibility icon that could be used as an overlay or prefix.
 * Returns a character/emoji that represents the visibility.
 */
export function getVisibilityIndicator(visibility: VisibilityModifier): string {
  switch (visibility) {
    case "public":
      return "🟢"; // Green circle = public
    case "private":
      return "🔴"; // Red circle = private
    case "protected":
      return "🟡"; // Yellow circle = protected
    case "internal":
      return "🔵"; // Blue circle = internal
    case "protected-internal":
      return "🟠"; // Orange = protected internal
    case "private-protected":
      return "🟣"; // Purple = private protected
    case "package":
      return "🔵";
    default:
      return "";
  }
}

/**
 * Get a text-based indicator for static members.
 */
export function getStaticIndicator(isStatic: boolean): string {
  return isStatic ? "S" : "";
}

/**
 * Creates an enhanced tooltip that includes modifier information.
 *
 * @param baseTooltip The original tooltip text
 * @param modifiers The symbol's modifiers
 * @returns Enhanced tooltip with modifier details
 */
export function createModifierTooltip(baseTooltip: string, modifiers: SymbolModifiers): string {
  const modifierDesc = getModifierDescription(modifiers);
  if (modifierDesc === "") {
    return baseTooltip;
  }
  return `[${modifierDesc}] ${baseTooltip}`;
}

/**
 * Badge characters for modifier indicators.
 * Using compact unicode symbols that render well in tree views.
 */
const MODIFIER_BADGES = {
  private: "🔒",         // Padlock for private
  protected: "🛡️",       // Shield for protected
  static: "ˢ",           // Superscript S for static (smaller than Ⓢ)
  readonly: "ʳ",         // Superscript r for readonly
  const: "ᶜ",            // Superscript c for const
  abstract: "ᵃ",         // Superscript a for abstract
  async: "⚡",            // Lightning bolt for async
} as const;

/**
 * Creates modifier badge symbols string.
 * Used for both label prefix and description positions.
 *
 * Badge order: visibility first (🔒🛡️), then static (ˢ)
 *
 * @param modifiers The symbol's modifiers
 * @param config The icon configuration
 * @returns Badge string or undefined if no badges
 */
function createModifierBadges(
  modifiers: SymbolModifiers,
  config: ModifierIconConfig
): string | undefined {
  const parts: string[] = [];

  // Add visibility badge
  switch (modifiers.visibility) {
    case "private":
    case "private-protected":
      parts.push(MODIFIER_BADGES.private);
      break;
    case "protected":
    case "protected-internal":
      parts.push(MODIFIER_BADGES.protected);
      break;
    // public and internal don't get badges (they're the "expected" state)
  }

  // Add static indicator
  if (config.showStaticIndicator && modifiers.memberModifiers.isStatic) {
    parts.push(MODIFIER_BADGES.static);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join("");
}

/**
 * Creates a label prefix string for tree item that shows modifier badges.
 * This appears BETWEEN the icon and the label text.
 *
 * Format: "🔒ˢ " (padlock + static badge + space before name)
 *
 * @param modifiers The symbol's modifiers
 * @param config The icon configuration
 * @returns Label prefix string or empty string if no badges
 */
export function createModifierLabelPrefix(
  modifiers: SymbolModifiers,
  config: ModifierIconConfig
): string {
  if (config.badgePosition !== "labelPrefix") {
    return "";
  }

  const badges = createModifierBadges(modifiers, config);
  if (badges === undefined) {
    return "";
  }

  return badges + " ";
}

/**
 * Creates a description string for tree item that shows modifier badges.
 * This appears to the right of the tree item label.
 *
 * Uses unicode symbols for compact visual indication:
 * - 🔒 for private members
 * - 🛡️ for protected members  
 * - ˢ for static members
 *
 * @param modifiers The symbol's modifiers
 * @param config The icon configuration
 * @returns Description string or undefined
 */
export function createModifierDescription(
  modifiers: SymbolModifiers,
  config: ModifierIconConfig
): string | undefined {
  if (config.badgePosition !== "description") {
    // When using label prefix, description shows other modifiers
    return createTextDescription(modifiers);
  }

  const parts: string[] = [];

  // Add visibility badge
  const badges = createModifierBadges(modifiers, config);
  if (badges !== undefined) {
    parts.push(badges);
  }

  // Add text modifiers
  const textDesc = createTextDescription(modifiers);
  if (textDesc !== undefined) {
    parts.push(textDesc);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

/**
 * Creates text description for non-visibility modifiers.
 */
function createTextDescription(modifiers: SymbolModifiers): string | undefined {
  const parts: string[] = [];

  // Add readonly/const indicator
  if (modifiers.memberModifiers.isReadonly) {
    parts.push("readonly");
  } else if (modifiers.memberModifiers.isConst) {
    parts.push("const");
  }

  // Add abstract indicator
  if (modifiers.memberModifiers.isAbstract) {
    parts.push("abstract");
  }

  // Add async indicator
  if (modifiers.memberModifiers.isAsync) {
    parts.push("async");
  }

  if (parts.length === 0) {
    return undefined;
  }

  return parts.join(" ");
}

/**
 * Gets the visibility level as a numeric value for filtering/sorting.
 * Higher = more accessible.
 */
export function getVisibilityLevel(visibility: VisibilityModifier): number {
  switch (visibility) {
    case "public":
      return 4;
    case "protected-internal":
      return 3;
    case "protected":
    case "internal":
    case "package":
      return 2;
    case "private-protected":
      return 1;
    case "private":
      return 0;
    default:
      return -1; // Unknown
  }
}
