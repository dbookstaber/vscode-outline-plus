/**
 * Represents visibility/access modifiers for a symbol.
 */
export type VisibilityModifier =
  | "public"
  | "private"
  | "protected"
  | "internal"
  | "protected-internal"
  | "private-protected"
  | "package" // Java/Kotlin default package-private
  | "default"; // Unknown/not determined

/**
 * Represents additional modifiers for a symbol.
 */
export type MemberModifiers = {
  isStatic: boolean;
  isReadonly: boolean;
  isConst: boolean;
  isAbstract: boolean;
  isVirtual: boolean;
  isOverride: boolean;
  isAsync: boolean;
  isSealed: boolean;
  isExtern: boolean;
  isVolatile: boolean;
  isNew: boolean; // C# "new" modifier for hiding
};

/**
 * Complete modifier information for a symbol.
 */
export type SymbolModifiers = {
  visibility: VisibilityModifier;
  memberModifiers: MemberModifiers;
};

/**
 * Default modifiers when none are detected.
 */
export function getDefaultModifiers(): SymbolModifiers {
  return {
    visibility: "default",
    memberModifiers: {
      isStatic: false,
      isReadonly: false,
      isConst: false,
      isAbstract: false,
      isVirtual: false,
      isOverride: false,
      isAsync: false,
      isSealed: false,
      isExtern: false,
      isVolatile: false,
      isNew: false,
    },
  };
}

/**
 * Check if any modifier is present (beyond defaults).
 */
export function hasAnyModifier(modifiers: SymbolModifiers): boolean {
  if (modifiers.visibility !== "default") {
    return true;
  }
  const { memberModifiers } = modifiers;
  return (
    memberModifiers.isStatic ||
    memberModifiers.isReadonly ||
    memberModifiers.isConst ||
    memberModifiers.isAbstract ||
    memberModifiers.isVirtual ||
    memberModifiers.isOverride ||
    memberModifiers.isAsync ||
    memberModifiers.isSealed ||
    memberModifiers.isExtern ||
    memberModifiers.isVolatile ||
    memberModifiers.isNew
  );
}

/**
 * Create a short description string for the modifiers.
 */
export function getModifierDescription(modifiers: SymbolModifiers): string {
  const parts: string[] = [];

  // Visibility
  if (modifiers.visibility !== "default") {
    parts.push(formatVisibility(modifiers.visibility));
  }

  // Member modifiers
  const { memberModifiers } = modifiers;
  if (memberModifiers.isStatic) parts.push("static");
  if (memberModifiers.isAbstract) parts.push("abstract");
  if (memberModifiers.isVirtual) parts.push("virtual");
  if (memberModifiers.isOverride) parts.push("override");
  if (memberModifiers.isSealed) parts.push("sealed");
  if (memberModifiers.isReadonly) parts.push("readonly");
  if (memberModifiers.isConst) parts.push("const");
  if (memberModifiers.isAsync) parts.push("async");
  if (memberModifiers.isExtern) parts.push("extern");
  if (memberModifiers.isVolatile) parts.push("volatile");
  if (memberModifiers.isNew) parts.push("new");

  return parts.join(" ");
}

function formatVisibility(visibility: VisibilityModifier): string {
  switch (visibility) {
    case "protected-internal":
      return "protected internal";
    case "private-protected":
      return "private protected";
    default:
      return visibility;
  }
}
