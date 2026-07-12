import * as vscode from "vscode";
import { getOutlinePlusConfig } from "../config/config";
import { logError, showDebugLog } from "../utils/debugLog";

type LanguageId = string;

export type RegexOrArray = RegExp | RegExp[];

type RegionBoundaryPattern = {
  /** The regular expression that matches the start of a region. Should ideally capture the name of the region. */
  startRegex: RegexOrArray;
  /** The regular expression that matches the end of a region. */
  endRegex: RegexOrArray;
};
type RegionBoundaryPatternMap = Record<LanguageId, RegionBoundaryPattern>;

type RegexStringOrArray = string | string[];

type RawRegionBoundaryPattern = {
  startRegex: RegexStringOrArray;
  endRegex: RegexStringOrArray;
};
type RegionBoundaryPatternsConfig = Record<LanguageId, RawRegionBoundaryPattern>;

/**
 * The fully qualified setting key that this module watches. Exported so callers
 * (e.g. extension activation) can scope `onDidChangeConfiguration` listeners.
 */
export const REGION_BOUNDARY_PATTERN_CONFIG_KEY = "outlinePlus.regionBoundaryPatternByLanguageId";

let cachedPatternMap: RegionBoundaryPatternMap | undefined;

export function getRegionBoundaryPatternMap(): RegionBoundaryPatternMap {
  cachedPatternMap ??= buildRegionBoundaryPatternMap();
  return cachedPatternMap;
}

/**
 * Invalidates the cached pattern map so the next `getRegionBoundaryPatternMap()`
 * call re-reads and re-compiles from the workspace configuration.
 *
 * Used by the configuration-change listener and by tests that mutate the
 * underlying configuration.
 */
export function refreshRegionBoundaryPatternMap(): RegionBoundaryPatternMap {
  cachedPatternMap = buildRegionBoundaryPatternMap();
  return cachedPatternMap;
}

/**
 * The language ids that currently have a *valid* region boundary pattern (a
 * language whose configured pattern fails to compile is dropped from the map, so
 * it is intentionally excluded here — folding for an uncompilable pattern would
 * parse nothing anyway). Used to scope the folding-range provider's document
 * selector so unconfigured languages (plaintext, logs, diffs of other langs)
 * never route through a from-scratch synchronous parse (plan 4.5).
 */
export function getConfiguredRegionLanguageIds(): string[] {
  return Object.keys(getRegionBoundaryPatternMap());
}

/**
 * Registers a `workspace.onDidChangeConfiguration` listener that refreshes the
 * compiled pattern map whenever the user edits
 * `outlinePlus.regionBoundaryPatternByLanguageId`, then invokes `onChange` so
 * the caller can re-parse open documents.
 */
export function registerRegionBoundaryPatternConfigListener(
  subscriptions: vscode.Disposable[],
  onChange: () => void
): void {
  const disposable = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration(REGION_BOUNDARY_PATTERN_CONFIG_KEY)) {
      return;
    }
    refreshRegionBoundaryPatternMap();
    onChange();
  });
  subscriptions.push(disposable);
}

/**
 * Signatures (`languageId + serialized pattern`) already surfaced to the user so
 * a given invalid pattern is only warned about once — not on every reparse.
 */
const warnedInvalidPatternSignatures = new Set<string>();

function buildRegionBoundaryPatternMap(): RegionBoundaryPatternMap {
  const rawBoundaryPatternByLanguageId = getRegionBoundaryPatternsConfig();
  const defaultBoundaryPatternByLanguageId = getDefaultRegionBoundaryPatternsConfig();
  return parseLanguagePatternsConfig(
    rawBoundaryPatternByLanguageId,
    defaultBoundaryPatternByLanguageId
  );
}

function getRegionBoundaryPatternsConfig(): RegionBoundaryPatternsConfig {
  const config = getOutlinePlusConfig();
  return config.get("regionBoundaryPatternByLanguageId", {});
}

/**
 * The extension's shipped default patterns, used to distinguish a user's (or
 * workspace's) custom pattern from a packaged one. We only warn the user about
 * invalid patterns they can actually fix — a broken shipped default is our bug,
 * not theirs.
 */
function getDefaultRegionBoundaryPatternsConfig(): RegionBoundaryPatternsConfig {
  const config = getOutlinePlusConfig();
  const inspected = config.inspect<RegionBoundaryPatternsConfig>(
    "regionBoundaryPatternByLanguageId"
  );
  return inspected?.defaultValue ?? {};
}

function parseLanguagePatternsConfig(
  rawBoundaryPatternByLanguageId: RegionBoundaryPatternsConfig,
  defaultBoundaryPatternByLanguageId: RegionBoundaryPatternsConfig
): RegionBoundaryPatternMap {
  const parsedPatternByLanguageId: RegionBoundaryPatternMap = {};
  const invalidNonDefaultLanguageIds: string[] = [];
  for (const [languageId, pattern] of Object.entries(rawBoundaryPatternByLanguageId)) {
    const parsedPattern = parseRegionBoundaryPattern(pattern, languageId);
    if (!parsedPattern) {
      if (!isDefaultPattern(pattern, defaultBoundaryPatternByLanguageId[languageId])) {
        invalidNonDefaultLanguageIds.push(languageId);
      }
      continue;
    }
    parsedPatternByLanguageId[languageId] = parsedPattern;
  }
  maybeWarnInvalidNonDefaultPatterns(
    invalidNonDefaultLanguageIds,
    rawBoundaryPatternByLanguageId
  );
  return parsedPatternByLanguageId;
}

function isDefaultPattern(
  pattern: RawRegionBoundaryPattern,
  defaultPattern: RawRegionBoundaryPattern | undefined
): boolean {
  if (defaultPattern === undefined) {
    return false;
  }
  return JSON.stringify(pattern) === JSON.stringify(defaultPattern);
}

/**
 * Surfaces a single, dismissable warning (with a "Show Log" action) naming the
 * language(s) whose user/workspace-provided region patterns failed to compile.
 * Without this, an invalid regex silently disables region support for that
 * language with the only trace in a Debug Log channel the user never opens.
 * Warns once per distinct (language, pattern) so it doesn't nag on every reparse.
 */
function maybeWarnInvalidNonDefaultPatterns(
  invalidNonDefaultLanguageIds: string[],
  rawBoundaryPatternByLanguageId: RegionBoundaryPatternsConfig
): void {
  const newlyInvalidLanguageIds = invalidNonDefaultLanguageIds.filter((languageId) => {
    const signature = `${languageId}:${JSON.stringify(
      rawBoundaryPatternByLanguageId[languageId]
    )}`;
    if (warnedInvalidPatternSignatures.has(signature)) {
      return false;
    }
    warnedInvalidPatternSignatures.add(signature);
    return true;
  });
  if (newlyInvalidLanguageIds.length === 0) {
    return;
  }
  const languageList = newlyInvalidLanguageIds.join(", ");
  const message =
    `Outline++: invalid region boundary pattern for ${languageList}. ` +
    `Region detection is disabled for ${
      newlyInvalidLanguageIds.length === 1 ? "this language" : "these languages"
    } until the pattern is fixed.`;
  void vscode.window.showWarningMessage(message, "Show Log").then((selection) => {
    if (selection === "Show Log") {
      showDebugLog();
    }
  });
}

function parseRegionBoundaryPattern(
  rawPattern: RawRegionBoundaryPattern,
  languageId: string
): RegionBoundaryPattern | undefined {
  try {
    return {
      startRegex: parseRegexOrArray(rawPattern.startRegex),
      endRegex: parseRegexOrArray(rawPattern.endRegex),
    };
  } catch (e) {
    logError(`Failed to parse region boundary pattern for language '${languageId}'`, e);
    return undefined;
  }
}

function parseRegexOrArray(input: RegexStringOrArray): RegexOrArray {
  if (Array.isArray(input)) {
    return input.map((s) => new RegExp(s));
  } else {
    return new RegExp(input);
  }
}
