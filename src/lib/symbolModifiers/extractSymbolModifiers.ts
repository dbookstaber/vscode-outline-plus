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
  /**
   * When true, keyword matching is case-insensitive for this language. Defaults
   * to false (case-sensitive) — the correct behavior for every C-family language.
   * Only set this for genuinely case-insensitive languages (e.g. Visual Basic),
   * so that identifiers like `Static`/`Override`/`Async` in case-sensitive
   * languages are NOT mistaken for modifier keywords.
   */
  caseInsensitive?: boolean;
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
  // C is intentionally excluded: it has no access specifiers (and no classes),
  // so there is nothing for visibility extraction to do. C++ visibility is
  // handled by a dedicated access-section scan (see extractCppSectionVisibility).
  languages: ["cpp"],
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
 * Precompiled form of a {@link ModifierPatternConfig}.
 *
 * Plan 4.2: previously every extraction call built O(symbols × keywords) fresh
 * `RegExp` objects (one per visibility keyword plus 1–3 per member keyword), and
 * the result cache was invalidated on every keystroke — so a single edit tick
 * recompiled dozens of regexes per symbol. These patterns depend only on the
 * (static) language config, so we compile them exactly once at module load and
 * reuse the objects forever. The hot path (`extractVisibility` /
 * `extractMemberModifiers`) now constructs zero `RegExp` objects.
 */
type CompiledVisibilityKeyword = {
  visibility: VisibilityModifier;
  /** Length of the source keyword, used to break earliest-position ties. */
  keywordLength: number;
  /** `\bkeyword\b`, non-global so `String.search`/`test` are stateless. */
  regex: RegExp;
};

type CompiledMemberKeyword = {
  modifierKey: string;
  regexes: RegExp[];
};

type CompiledPatternConfig = {
  visibility: CompiledVisibilityKeyword[];
  memberKeywords: CompiledMemberKeyword[];
};

function compilePatternConfig(config: ModifierPatternConfig): CompiledPatternConfig {
  const flags = config.caseInsensitive === true ? "i" : "";
  const supportsCSharpAttributes = config.languages.includes("csharp");
  const supportsAtDecorators = configHasAtPrefixedMemberKeyword(config);

  const visibility: CompiledVisibilityKeyword[] = [];
  for (const [keyword, vis] of Object.entries(config.visibilityKeywords)) {
    visibility.push({
      visibility: vis,
      keywordLength: keyword.length,
      regex: new RegExp(`\\b${escapeRegex(keyword)}\\b`, flags),
    });
  }

  const memberKeywords: CompiledMemberKeyword[] = [];
  for (const [modifierKey, keywords] of Object.entries(config.memberKeywords)) {
    if (keywords.length === 0) continue;
    for (const keyword of keywords) {
      const regexes: RegExp[] = [];
      if (keyword.startsWith("@")) {
        // Decorator keyword (e.g., @staticmethod) — match as-is. Cannot use \b
        // (@ is not a word char) and must not prepend another @.
        regexes.push(new RegExp(escapeRegex(keyword), flags));
      } else {
        regexes.push(new RegExp(`\\b${escapeRegex(keyword)}\\b`, flags));
        // @-decorator form is gated to languages whose config declares an
        // @-prefixed keyword (Python today). C# attribute-bracket form is gated
        // to C#. See the module docs on extractMemberModifiers history.
        if (supportsAtDecorators) {
          regexes.push(new RegExp(`@${escapeRegex(keyword)}`, flags));
        }
        if (supportsCSharpAttributes) {
          regexes.push(new RegExp(`\\[${escapeRegex(keyword)}\\]`, flags));
        }
      }
      memberKeywords.push({ modifierKey, regexes });
    }
  }

  return { visibility, memberKeywords };
}

/** Precompiled patterns per config, built once at module load. */
const compiledPatternConfigs = new Map<ModifierPatternConfig, CompiledPatternConfig>(
  allPatternConfigs.map((config): [ModifierPatternConfig, CompiledPatternConfig] => [
    config,
    compilePatternConfig(config),
  ])
);

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

  const compiled = compiledPatternConfigs.get(patternConfig);
  if (compiled === undefined) {
    // Defensive: every config in allPatternConfigs is precompiled at module load.
    return modifiers;
  }

  // For Python, use naming conventions to detect visibility
  // (Python doesn't have visibility keywords, only naming conventions)
  if (languageId === "python") {
    applyPythonNamingConventionVisibility(symbol, modifiers);
  }

  // Get text from symbol definition line(s)
  // Read lines that are part of this symbol's declaration only
  const rawText = getSymbolDeclarationText(symbol, document, patternConfig);

  // Sanitize the declaration text before keyword scanning. This strips:
  //  - comments (so "private" in a doc comment is not read as visibility),
  //  - string literals (so keywords inside `"..."`/`'...'`/`` `...` `` are ignored),
  //  - parameter lists (so a TS parameter property `constructor(private foo)` does
  //    not leak `private`/`readonly` onto the enclosing symbol).
  const text = sanitizeDeclarationText(rawText);

  // Extract visibility.
  if (languageId === "cpp") {
    // C++ access control is section state (`public:`/`private:`/`protected:`
    // labels govern every following member), not a per-declaration keyword, so
    // it needs a dedicated scan rather than the shared keyword matcher.
    modifiers.visibility = extractCppSectionVisibility(symbol, document);
  } else if (languageId !== "python") {
    modifiers.visibility = extractVisibility(text, compiled, languageId);
  }

  // Extract member modifiers
  extractMemberModifiers(text, compiled, modifiers.memberModifiers);

  return modifiers;
}

/**
 * Extract visibility modifier from text.
 *
 * Plan 2.2(i): the winning keyword is chosen by EARLIEST POSITION in the text,
 * not by keyword length. Length-based selection wrongly reported
 * `public int X { get; private set; }` as private, because "private" (7 chars)
 * outranked "public" (6 chars) even though it appears later. Ties at the same
 * index prefer the LONGER keyword, so a combined modifier like
 * "protected internal" still beats the bare "protected" that starts at the same
 * position.
 */
function extractVisibility(
  text: string,
  compiled: CompiledPatternConfig,
  languageId: string
): VisibilityModifier {
  let best: { visibility: VisibilityModifier; index: number; length: number } | undefined;

  for (const candidate of compiled.visibility) {
    const index = text.search(candidate.regex);
    if (index === -1) continue;
    if (
      best === undefined ||
      index < best.index ||
      (index === best.index && candidate.keywordLength > best.length)
    ) {
      best = {
        visibility: candidate.visibility,
        index,
        length: candidate.keywordLength,
      };
    }
  }

  if (best !== undefined) {
    return best.visibility;
  }

  // Handle language-specific defaults when no visibility keyword is present
  if (languageId === "java") {
    // In Java, the absence of a visibility keyword means package-private access.
    return "package";
  }

  return "default";
}

/**
 * Extract member modifiers from text.
 *
 * Pattern forms tried per keyword:
 * - Always: `\bkeyword\b` (word-bounded match).
 * - C# only: `[keyword]` attribute form. Previously applied to every language,
 *   which caused false positives on TypeScript computed-property names like
 *   `{ [abstract]: true }`.
 * - Languages with `@`-prefixed entries in `memberKeywords` (Python today): try
 *   `@keyword` as well. Previously applied to every language, which caused
 *   false positives wherever `@async`, `@static`, etc. appeared in non-Python
 *   code.
 *
 * Keywords that themselves start with `@` (e.g. `@staticmethod`) are matched
 * as-is regardless of language gating.
 */
function extractMemberModifiers(
  text: string,
  compiled: CompiledPatternConfig,
  memberModifiers: MemberModifiers
): void {
  for (const entry of compiled.memberKeywords) {
    for (const pattern of entry.regexes) {
      if (pattern.test(text)) {
        setMemberModifier(memberModifiers, entry.modifierKey);
        break;
      }
    }
  }
}

function configHasAtPrefixedMemberKeyword(config: ModifierPatternConfig): boolean {
  for (const keywords of Object.values(config.memberKeywords)) {
    if (keywords.some((kw) => kw.startsWith("@"))) {
      return true;
    }
  }
  return false;
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
 * Strip comments and preprocessor directives from source text to prevent false
 * keyword matches. Handles:
 * - Block comments: /* ... * / (C-family)
 * - Line comments: // and /// (C-family)
 * - Preprocessor directives and standalone # comment lines (C#, C/C++, Python)
 *
 * This prevents XML doc comments like `/// Retrieve the private field...`,
 * line comments like `// private-field helpers`, and directives like
 * `#region Private Helpers` from polluting visibility extraction.
 *
 * Note: Python inline `#` comments (e.g., `def f(): # private helper`) are NOT
 * stripped because the regex cannot reliably distinguish `#` in comments from `#`
 * in string literals (e.g., `def f(pattern="#regex")`). Standalone `#` comment
 * lines are handled by the `^\s*#` pattern.
 */
function stripComments(text: string): string {
  // Remove block comments first (may span multiple lines)
  let result = text.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments (// and /// doc comments)
  result = result.replace(/\/\/.*$/gm, "");
  // Remove lines starting with # — covers C/C#/C++ preprocessor directives
  // (#region, #if, #include) and standalone Python comments (# comment).
  // Only matches when # is the first non-whitespace character on the line,
  // so it won't corrupt # inside string literals on code lines.
  result = result.replace(/^\s*#.*$/gm, "");
  return result;
}

/**
 * Sanitize declaration text prior to keyword scanning by removing regions that
 * can carry false keyword matches: comments, string literals, and parameter
 * lists. All helpers here use regex *literals* (not `new RegExp`), so this stays
 * off the precompiled hot path but does not construct cacheable patterns per
 * call in the O(keywords) sense that Plan 4.2 targets.
 */
function sanitizeDeclarationText(text: string): string {
  let result = stripComments(text);
  result = stripStringLiterals(result);
  result = stripParameterLists(result);
  return result;
}

/**
 * Remove the contents of string/char/template literals so keywords appearing
 * inside them (e.g. `[Obsolete("Use the private API")]`) are not mistaken for
 * modifiers. Plan 2.2(ii). Handles escaped quotes; leaves the surrounding
 * structure intact by replacing each literal with an empty pair of delimiters.
 */
function stripStringLiterals(text: string): string {
  let result = text.replace(/"(?:[^"\\]|\\.)*"/g, '""');
  result = result.replace(/'(?:[^'\\]|\\.)*'/g, "''");
  result = result.replace(/`(?:[^`\\]|\\.)*`/g, "``");
  return result;
}

/**
 * Collapse parenthesized parameter lists to `()`.
 *
 * Plan 2.2(iii): a symbol's own modifiers always precede its parameter list, so
 * anything inside the parentheses belongs to parameters — not the symbol. This
 * prevents TypeScript parameter properties like `constructor(private readonly x)`
 * from leaking `private`/`readonly` onto the constructor, while leaving genuine
 * modifiers (which sit before `(`, or after `)` like C++ trailing `const`
 * /`override`) untouched. Repeatedly collapses the innermost parens to also
 * handle nesting.
 */
function stripParameterLists(text: string): string {
  let result = text;
  let previous: string;
  do {
    previous = result;
    result = result.replace(/\([^()]*\)/g, "()");
  } while (result !== previous);
  return result;
}

/** Matches a C++ access-specifier label line, e.g. `  public:` or `private :`. */
const CPP_ACCESS_LABEL_PATTERN = /^\s*(public|private|protected)\s*:/;

/**
 * Determine a C++ member's visibility from its enclosing access-specifier
 * section.
 *
 * Plan 2.9: access control in C++ is stateful — a `public:` / `private:` /
 * `protected:` label governs every following member until the next label — so
 * the shared per-declaration keyword matcher (and the 3-line backward scan)
 * could only ever color the FIRST member after a label. This walks upward from
 * the member to the nearest preceding access label at the member's own brace
 * depth, skipping over nested method bodies via brace balancing, and stopping
 * once we ascend past the opening brace of the enclosing class/struct.
 *
 * Known limitations (documented, acceptable for a heuristic outline decorator):
 *  - `struct`/`union` members default to public and `class` members to private
 *    when no explicit label precedes them; we return "default" in that case
 *    rather than guessing the container kind.
 *  - Deeply nested classes with their own access labels are handled only to the
 *    extent brace balancing keeps us in the member's section.
 */
function extractCppSectionVisibility(
  symbol: vscode.DocumentSymbol,
  document: vscode.TextDocument
): VisibilityModifier {
  const symbolLine = symbol.selectionRange.start.line;
  const lineCount = document.lineCount;
  if (lineCount === 0 || symbolLine >= lineCount) {
    return "default";
  }

  let braceBalance = 0;
  for (let line = symbolLine - 1; line >= 0; line--) {
    // Strip comments and strings so `//` text and `'{'`/`'}'` char literals do
    // not disturb label detection or brace counting.
    const clean = stripStringLiterals(stripComments(document.lineAt(line).text));

    if (braceBalance === 0) {
      const match = CPP_ACCESS_LABEL_PATTERN.exec(clean);
      if (match !== null) {
        // match[1] is exactly "public" | "private" | "protected".
        return match[1] as VisibilityModifier;
      }
    }

    for (const ch of clean) {
      if (ch === "}") {
        // Ascending into a nested block that closed above the member.
        braceBalance++;
      } else if (ch === "{") {
        braceBalance--;
      }
    }

    if (braceBalance < 0) {
      // We passed the opening brace of the enclosing class/struct — the member's
      // section has no access label above it.
      break;
    }
  }

  return "default";
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
 * - __name__: dunder/magic method, conventionally "public"
 * - __name: name mangling, conventionally "private"
 * - _name: conventionally "protected"
 * - name: conventionally "public"
 */
function applyPythonNamingConventionVisibility(
  symbol: vscode.DocumentSymbol,
  modifiers: SymbolModifiers
): void {
  const name = symbol.name;

  if (name.startsWith("__") && name.endsWith("__")) {
    // Dunder/magic method (e.g., __init__, __str__) = public
    modifiers.visibility = "public";
  } else if (name.startsWith("__")) {
    // Double underscore prefix (name mangling) = private
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
 * Cache for modifier extraction results to avoid re-reading documents.
 *
 * Keyed first by document URI. Each per-URI entry stores the document version
 * the cached modifiers were computed for; when the version advances, the inner
 * map is replaced wholesale. This bounds cache size to "one entry per live
 * symbol", instead of accumulating dead per-version entries until the LRU
 * eviction pass kicks in (a 200-symbol file edited 25 times used to fill 5000
 * slots with stale data).
 *
 * To bound memory across many open documents we also LRU-evict whole URI
 * entries when the outer map exceeds {@link MAX_CACHED_DOCUMENTS}.
 */
type DocumentModifierCacheEntry = {
  version: number;
  entries: Map<string, SymbolModifiers>;
};

const MAX_CACHED_DOCUMENTS = 100;
const modifierCache = new Map<string, DocumentModifierCacheEntry>();

/**
 * Position-and-name key within a single document version.
 */
function getSymbolPositionKey(symbol: vscode.DocumentSymbol): string {
  return `${symbol.range.start.line}:${symbol.range.start.character}:${symbol.name}`;
}

/**
 * Extracts modifiers with caching support.
 */
export function extractSymbolModifiersWithCache(
  symbol: vscode.DocumentSymbol,
  document: vscode.TextDocument
): SymbolModifiers {
  const uri = document.uri.toString();
  const version = document.version;

  const existing = modifierCache.get(uri);
  let docEntry: DocumentModifierCacheEntry;
  if (existing?.version === version) {
    // LRU: re-insert to move the URI to the end of iteration order.
    docEntry = existing;
    modifierCache.delete(uri);
    modifierCache.set(uri, docEntry);
  } else {
    // Either a fresh URI or a newer document version — discard any prior entries
    // for this URI and start a new map for the current version.
    docEntry = { version, entries: new Map() };
    modifierCache.set(uri, docEntry);
  }

  const positionKey = getSymbolPositionKey(symbol);
  const cached = docEntry.entries.get(positionKey);
  if (cached) {
    return cached;
  }

  const modifiers = extractSymbolModifiers(symbol, document);
  docEntry.entries.set(positionKey, modifiers);

  // Bound the cache by URI count. When exceeded, drop the oldest URI entries.
  while (modifierCache.size > MAX_CACHED_DOCUMENTS) {
    const oldestKey = modifierCache.keys().next().value;
    if (oldestKey === undefined) break;
    modifierCache.delete(oldestKey);
  }

  return modifiers;
}

/**
 * Clear the modifier cache (e.g., when document changes significantly, or
 * between test suites to ensure isolation).
 */
export function clearModifierCache(): void {
  modifierCache.clear();
}

/**
 * For tests: introspect the number of cached document entries.
 */
export function _getModifierCacheDocumentCount(): number {
  return modifierCache.size;
}

/**
 * For tests: introspect the total number of cached symbol entries across all documents.
 */
export function _getModifierCacheTotalEntryCount(): number {
  let total = 0;
  for (const entry of modifierCache.values()) {
    total += entry.entries.size;
  }
  return total;
}
