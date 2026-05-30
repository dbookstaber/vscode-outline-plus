import * as vscode from "vscode";
import { getOutlinePlusConfig } from "../config/regionHelperConfig";
import { logError } from "../utils/debugLog";

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

function buildRegionBoundaryPatternMap(): RegionBoundaryPatternMap {
  const rawBoundaryPatternByLanguageId = getRegionBoundaryPatternsConfig();
  return parseLanguagePatternsConfig(rawBoundaryPatternByLanguageId);
}

function getRegionBoundaryPatternsConfig(): RegionBoundaryPatternsConfig {
  const config = getOutlinePlusConfig();
  return config.get("regionBoundaryPatternByLanguageId", {});
}

function parseLanguagePatternsConfig(
  rawBoundaryPatternByLanguageId: RegionBoundaryPatternsConfig
): RegionBoundaryPatternMap {
  const parsedPatternByLanguageId: RegionBoundaryPatternMap = {};
  for (const [languageId, pattern] of Object.entries(rawBoundaryPatternByLanguageId)) {
    const parsedPattern = parseRegionBoundaryPattern(pattern, languageId);
    if (!parsedPattern) {
      continue;
    }
    parsedPatternByLanguageId[languageId] = parsedPattern;
  }
  return parsedPatternByLanguageId;
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
