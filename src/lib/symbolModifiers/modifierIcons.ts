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
  /** Whether to add visibility badge suffix to icon */
  showVisibilityBadge: boolean;
  /** Whether to add static indicator */
  showStaticIndicator: boolean;
};

/**
 * Get default modifier icon configuration.
 */
export function getDefaultModifierIconConfig(): ModifierIconConfig {
  return {
    showVisibilityColors: true,
    useDistinctColors: true,
    showVisibilityBadge: false, // VS Code doesn't support icon badges yet
    showStaticIndicator: true,
  };
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
 * Creates a description string for tree item that shows modifier badges.
 * This appears to the right of the tree item label.
 *
 * @param modifiers The symbol's modifiers
 * @param config The icon configuration
 * @returns Description string or undefined
 */
export function createModifierDescription(
  modifiers: SymbolModifiers,
  config: ModifierIconConfig
): string | undefined {
  const parts: string[] = [];

  // Add static indicator
  if (config.showStaticIndicator && modifiers.memberModifiers.isStatic) {
    parts.push("static");
  }

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

  return parts.join(", ");
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
