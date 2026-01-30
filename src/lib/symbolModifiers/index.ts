/**
 * Symbol modifiers module - provides extraction and rendering of symbol modifiers
 * (visibility, static, readonly, etc.) for the Full Outline view.
 */

export {
  getDefaultModifiers, getModifierDescription, hasAnyModifier, type MemberModifiers,
  type SymbolModifiers, type VisibilityModifier
} from "./SymbolModifiers";

export {
  clearModifierCache, extractSymbolModifiers,
  extractSymbolModifiersWithCache
} from "./extractSymbolModifiers";

export {
  createModifierAwareIcon, createModifierDescription, createModifierTooltip, getDefaultModifierIconConfig, getStaticIndicator, getVisibilityIndicator, getVisibilityLevel, type ModifierIconConfig
} from "./modifierIcons";

