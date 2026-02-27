import * as vscode from "vscode";
import {
    getDefaultModifiers,
    type MemberModifiers,
    type SymbolModifiers,
    type VisibilityModifier,
} from "./SymbolModifiers";

/**
 * Language-specific pattern configuration for modifier detection.
 */
type ModifierPatternConfig = {
  /** Languages that use this pattern set (VS Code language IDs) */
  languages: string[];
  /** Visibility keywords mapped to their VisibilityModifier values */
  visibilityKeywords: Record<string, VisibilityModifier>;
  /** Keywords that indicate member modifiers */
  memberKeywords: Partial<Record<keyof MemberModifiers, string[]>>;
  /** Regex to detect parent type declarations (used as a boundary when scanning backwards) */
  typeDeclarationPattern?: RegExp;
};

/**
 * C-family languages modifier patterns (C#, Java, Kotlin, TypeScript, etc.)
 */
const csharpPatterns: ModifierPatternConfig = {
  languages: ["csharp"],
  visibilityKeywords: {
    public: "public",
    private: "private",
    protected: "protected",
    internal: "internal",
    "protected internal": "protected-internal",
    "internal protected": "protected-internal",
    "private protected": "private-protected",
    "protected private": "private-protected",
  },
  memberKeywords: {
    isStatic: ["static"],
    isReadonly: ["readonly"],
    isConst: ["const"],
    isAbstract: ["abstract"],
    isVirtual: ["virtual"],
    isOverride: ["override"],
    isAsync: ["async"],
    isSealed: ["sealed"],
    isExtern: ["extern"],
    isVolatile: ["volatile"],
    isNew: ["new"],
  },
  typeDeclarationPattern:
    /\b(public|private|protected|internal)\s+(sealed\s+|abstract\s+|static\s+|partial\s+)*(class|struct|interface|enum|record)\b/i,
};

const javaPatterns: ModifierPatternConfig = {
  languages: ["java"],
  visibilityKeywords: {
    public: "public",
    private: "private",
    protected: "protected",
    // Java default (package-private) has no keyword
  },
  memberKeywords: {
    isStatic: ["static"],
    isConst: ["final"], // Java uses 'final' for constants
    isAbstract: ["abstract"],
    isVolatile: ["volatile"],
    isSealed: ["sealed"], // Java 17+
  },
  typeDeclarationPattern:
    /\b(public|private|protected)\s+(static\s+|abstract\s+|final\s+|sealed\s+)*(class|interface|enum|record)\b/i,
};

const kotlinPatterns: ModifierPatternConfig = {
  languages: ["kotlin"],
  visibilityKeywords: {
    public: "public",
    private: "private",
    protected: "protected",
    internal: "internal",
  },
  memberKeywords: {
    isStatic: ["companion"], // Kotlin uses companion objects
    isConst: ["const", "val"],
    isAbstract: ["abstract"],
    isOverride: ["override"],
    isSealed: ["sealed"],
  },
  typeDeclarationPattern:
    /\b(public|private|protected|internal)\s+(sealed\s+|abstract\s+|data\s+|open\s+)*(class|interface|enum|object)\b/i,
};

const typescriptPatterns: ModifierPatternConfig = {
  languages: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
  visibilityKeywords: {
    public: "public",
    private: "private",
    protected: "protected",
  },
  memberKeywords: {
    isStatic: ["static"],
    isReadonly: ["readonly"],
    isConst: ["const"],
    isAbstract: ["abstract"],
    isAsync: ["async"],
    isOverride: ["override"],
  },
  typeDeclarationPattern:
    /\b(export\s+)?(abstract\s+)?(class|interface|enum)\b/i,
};

const cppPatterns: ModifierPatternConfig = {
  languages: ["cpp", "c"],
  visibilityKeywords: {
    public: "public",
    private: "private",
    protected: "protected",
  },
  memberKeywords: {
    isStatic: ["static"],
    isConst: ["const", "constexpr"],
    isVirtual: ["virtual"],
    isOverride: ["override"],
    isVolatile: ["volatile"],
    isExtern: ["extern"],
  },
  typeDeclarationPattern:
    /\b(class|struct|enum|union)\s+\w+/i,
};

const pythonPatterns: ModifierPatternConfig = {
  languages: ["python"],
  visibilityKeywords: {
    // Python uses naming conventions, not keywords
  },
  memberKeywords: {
    isStatic: ["@staticmethod", "@classmethod"],
    isAbstract: ["@abstractmethod"],
    isAsync: ["async"],
  },
  typeDeclarationPattern:
    /\b(class|def)\s+\w+/i,
};

/**
 * All supported pattern configurations.
 */
const allPatternConfigs: ModifierPatternConfig[] = [
  csharpPatterns,
  javaPatterns,
  kotlinPatterns,
  typescriptPatterns,
  cppPatterns,
  pythonPatterns,
];

/**
 * Get the pattern configuration for a given language ID.
 */
function getPatternConfig(languageId: string): ModifierPatternConfig | undefined {
  return allPatternConfigs.find((config) => config.languages.includes(languageId));
}

/**
 * Extracts modifiers from a symbol by reading the source line where the symbol is defined.
 *
 * @param symbol - The document symbol to extract modifiers from
 * @param document - The text document containing the symbol
 * @returns The extracted modifiers
 */
export function extractSymbolModifiers(
  symbol: vscode.DocumentSymbol,
  document: vscode.TextDocument
): SymbolModifiers {
  const modifiers = getDefaultModifiers();
  const languageId = document.languageId;
  const patternConfig = getPatternConfig(languageId);

  if (!patternConfig) {
    // Language not supported
    return modifiers;
  }

  // For Python, use naming conventions to detect visibility
  // (Python doesn't have visibility keywords, only naming conventions)
  if (languageId === "python") {
    applyPythonNamingConventionVisibility(symbol, modifiers);
  }

  // Get text from symbol definition line(s)
  // Read lines that are part of this symbol's declaration only
  const text = getSymbolDeclarationText(symbol, document, patternConfig);

  // Extract visibility (for languages with keywords)
  if (languageId !== "python") {
    modifiers.visibility = extractVisibility(text, patternConfig, languageId);
  }

  // Extract member modifiers
  extractMemberModifiers(text, patternConfig, modifiers.memberModifiers);

  return modifiers;
}

/**
 * Extract visibility modifier from text.
 */
function extractVisibility(
  text: string,
  config: ModifierPatternConfig,
  languageId: string
): VisibilityModifier {
  // Check for combined modifiers first (e.g., "protected internal")
  const sortedKeywords = Object.keys(config.visibilityKeywords).sort(
    (a, b) => b.length - a.length
  );

  for (const keyword of sortedKeywords) {
    // Use word boundary to match whole keyword only
    const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
    if (regex.test(text)) {
      const visibility = config.visibilityKeywords[keyword];
      if (visibility !== undefined) {
        return visibility;
      }
    }
  }

  // Handle language-specific defaults
  if (languageId === "java") {
    // Java default is package-private (no keyword)
    // Could look for absence of visibility keywords, but for now return default
    return "default";
  }

  return "default";
}

/**
 * Extract member modifiers from text.
 */
function extractMemberModifiers(
  text: string,
  config: ModifierPatternConfig,
  memberModifiers: MemberModifiers
): void {
  for (const [modifierKey, keywords] of Object.entries(config.memberKeywords)) {
    // Skip if no keywords defined for this modifier
    if (keywords.length === 0) continue;
    for (const keyword of keywords) {
      // Handle decorator/attribute syntax (@, [])
      const patterns = [
        new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i"), // Regular keyword
        new RegExp(`@${escapeRegex(keyword)}`, "i"), // Python decorator
        new RegExp(`\\[${escapeRegex(keyword)}\\]`, "i"), // C# attribute style
      ];

      for (const pattern of patterns) {
        if (pattern.test(text)) {
          setMemberModifier(memberModifiers, modifierKey);
          break;
        }
      }
    }
  }
}

/**
 * Safely sets a member modifier property on the modifiers object.
 */
function setMemberModifier(memberModifiers: MemberModifiers, key: string): void {
  switch (key) {
    case "isStatic":
      memberModifiers.isStatic = true;
      break;
    case "isReadonly":
      memberModifiers.isReadonly = true;
      break;
    case "isConst":
      memberModifiers.isConst = true;
      break;
    case "isAbstract":
      memberModifiers.isAbstract = true;
      break;
    case "isVirtual":
      memberModifiers.isVirtual = true;
      break;
    case "isOverride":
      memberModifiers.isOverride = true;
      break;
    case "isAsync":
      memberModifiers.isAsync = true;
      break;
    case "isSealed":
      memberModifiers.isSealed = true;
      break;
    case "isExtern":
      memberModifiers.isExtern = true;
      break;
    case "isVolatile":
      memberModifiers.isVolatile = true;
      break;
    case "isNew":
      memberModifiers.isNew = true;
      break;
  }
}

/**
 * Gets the text of a symbol's declaration, carefully avoiding text from other symbols.
 * Reads from the symbol's selection range line and up to 3 lines before it,
 * but stops at boundaries that indicate we've left this symbol's declaration.
 */
function getSymbolDeclarationText(
  symbol: vscode.DocumentSymbol,
  document: vscode.TextDocument,
  patternConfig: ModifierPatternConfig
): string {
  const symbolLine = symbol.selectionRange.start.line;
  const lineCount = document.lineCount;

  // Guard against empty documents or invalid line numbers
  if (lineCount === 0 || symbolLine >= lineCount) {
    return "";
  }

  let startLine = symbolLine;

  // Look backwards up to 3 lines for decorators/attributes, stopping at declaration boundaries
  for (let i = 1; i <= 3 && symbolLine - i >= 0; i++) {
    const prevLine = symbolLine - i;
    if (prevLine >= lineCount) {
      break;
    }
    const lineText = document.lineAt(prevLine).text;
    const trimmedLine = lineText.trim();

    // Stop conditions - we've left this symbol's declaration area:
    // 1. Empty/blank line
    if (trimmedLine === "") {
      break;
    }
    // 2. Line is just an opening or closing brace (start of a block)
    if (trimmedLine === "{" || trimmedLine === "}") {
      break;
    }
    // 3. Line ends with opening brace (class/method declaration with body start)
    if (trimmedLine.endsWith("{")) {
      break;
    }
    // 4. Line ends with closing brace or paren (end of another declaration)
    if (/[}\]);]$/.test(trimmedLine)) {
      break;
    }
    // 5. Line matches a type declaration pattern for this language
    //    This means we've reached a parent type declaration
    if (patternConfig.typeDeclarationPattern?.test(lineText) === true) {
      break;
    }

    startLine = prevLine;
  }

  const endLine = Math.min(symbolLine, lineCount - 1);
  const textRange = new vscode.Range(startLine, 0, endLine + 1, 0);
  return document.getText(textRange);
}

/**
 * Apply Python naming conventions to determine visibility.
 * - _name: conventionally "protected"
 * - __name: conventionally "private"
 * - name: conventionally "public"
 */
function applyPythonNamingConventionVisibility(
  symbol: vscode.DocumentSymbol,
  modifiers: SymbolModifiers
): void {
  const name = symbol.name;

  if (name.startsWith("__") && !name.endsWith("__")) {
    // Double underscore prefix (not dunder) = private
    modifiers.visibility = "private";
  } else if (name.startsWith("_")) {
    // Single underscore prefix = protected/internal
    modifiers.visibility = "protected";
  } else {
    // No underscore = public
    modifiers.visibility = "public";
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Cache for modifier extraction results to avoid re-reading document.
 * Key: symbol id (based on position and name), Value: parsed modifiers
 */
const modifierCache = new Map<string, SymbolModifiers>();

/**
 * Get a cache key for a symbol.
 */
function getSymbolCacheKey(
  symbol: vscode.DocumentSymbol,
  documentVersion: number,
  documentUri: string
): string {
  return `${documentUri}:${documentVersion}:${symbol.range.start.line}:${symbol.range.start.character}:${symbol.name}`;
}

/**
 * Extracts modifiers with caching support.
 */
export function extractSymbolModifiersWithCache(
  symbol: vscode.DocumentSymbol,
  document: vscode.TextDocument
): SymbolModifiers {
  const cacheKey = getSymbolCacheKey(symbol, document.version, document.uri.toString());
  const cached = modifierCache.get(cacheKey);
  if (cached) {
    // LRU: move to end of Map iteration order by re-inserting
    modifierCache.delete(cacheKey);
    modifierCache.set(cacheKey, cached);
    return cached;
  }

  const modifiers = extractSymbolModifiers(symbol, document);
  modifierCache.set(cacheKey, modifiers);

  // Evict oldest entries when cache exceeds limit
  if (modifierCache.size > 5000) {
    const keysToDelete = Array.from(modifierCache.keys()).slice(0, 1000);
    for (const key of keysToDelete) {
      modifierCache.delete(key);
    }
  }

  return modifiers;
}

/**
 * Clear the modifier cache (e.g., when document changes significantly).
 */
export function clearModifierCache(): void {
  modifierCache.clear();
}
