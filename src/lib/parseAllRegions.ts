import * as vscode from "vscode";
import { type Region } from "../models/Region";
import { log } from "../utils/debugLog";
import { getRegionBoundaryPatternMap, type RegexOrArray } from "./regionBoundaryPatterns";

export type InvalidMarker = {
  boundaryType: "start" | "end";
  lineIdx: number;
};

type RegionParseResult = {
  topLevelRegions: Region[];
  invalidMarkers: InvalidMarker[];
};

// Bail out on very large files to keep the host responsive; full scan would
// blow past the parse debounce window and stall the UI thread.
const LARGE_FILE_LINE_THRESHOLD = 100_000;

export function parseAllRegions(document: vscode.TextDocument): RegionParseResult {
  const topLevelRegions: Region[] = [];
  const invalidMarkers: InvalidMarker[] = [];
  const openRegionsStack: Region[] = [];

  if (document.lineCount > LARGE_FILE_LINE_THRESHOLD) {
    log(
      `parseAllRegions: skipping ${document.uri.toString()} (${document.lineCount} lines exceeds threshold ${LARGE_FILE_LINE_THRESHOLD})`
    );
    return { topLevelRegions, invalidMarkers };
  }

  const { languageId } = document;
  const regionBoundaryPatternByLanguageId = getRegionBoundaryPatternMap();
  const regionBoundaryPattern = regionBoundaryPatternByLanguageId[languageId];
  if (regionBoundaryPattern === undefined) {
    return { topLevelRegions, invalidMarkers };
  }

  const regionCountByEffectiveName = new Map<string, number>();

  const { startRegex, endRegex } = regionBoundaryPattern;
  // Single getText() + split avoids hundreds of thousands of TextLine allocations
  // that document.lineAt() would create on large files.
  const lines = document.getText().split(/\r?\n/);
  const lineCount = lines.length;
  let regionIdx = 0;
  for (let lineIdx = 0; lineIdx < lineCount; lineIdx++) {
    const lineText = lines[lineIdx] ?? "";
    const startMatch = matchLineWithRegexOrArray(lineText, startRegex);
    if (startMatch) {
      const newRegion = makeNewOpenRegion({
        startMatch,
        startLineIdx: lineIdx,
        regionIdx,
        regionCountByEffectiveName,
      });
      openRegionsStack.push(newRegion);
      regionIdx = 0;
      continue;
    }
    const endMatch = matchLineWithRegexOrArray(lineText, endRegex);
    if (!endMatch) {
      continue; // Not a start or end boundary; move to the next line
    }
    const lastOpenRegion = openRegionsStack.pop();
    if (!lastOpenRegion) {
      invalidMarkers.push({ boundaryType: "end", lineIdx });
      continue; // Can still treat following regions in editor as valid; move to the next line
    }
    lastOpenRegion.wasClosed = true;
    lastOpenRegion.range = new vscode.Range(
      lastOpenRegion.range.start.line,
      0,
      lineIdx,
      lineText.length
    );
    const maybeParentRegion = openRegionsStack[openRegionsStack.length - 1];
    if (maybeParentRegion) {
      lastOpenRegion.parent = maybeParentRegion;
      maybeParentRegion.children.push(lastOpenRegion);
    } else {
      topLevelRegions.push(lastOpenRegion);
    }
    regionIdx = lastOpenRegion.regionIdx + 1;
  }
  for (const openRegion of openRegionsStack) {
    invalidMarkers.push({ boundaryType: "start", lineIdx: openRegion.range.start.line });
    addClosedChildrenToTopLevelRegions(openRegion, topLevelRegions);
  }
  return { topLevelRegions, invalidMarkers };
}

function matchLineWithRegexOrArray(
  lineText: string,
  regexOrArray: RegexOrArray
): RegExpMatchArray | null {
  if (Array.isArray(regexOrArray)) {
    for (const regex of regexOrArray) {
      const match = lineText.match(regex);
      if (match) {
        return match;
      }
    }
    return null;
  }
  return lineText.match(regexOrArray);
}

function makeNewOpenRegion({
  startMatch,
  startLineIdx,
  regionIdx,
  regionCountByEffectiveName,
}: {
  startMatch: RegExpMatchArray;
  startLineIdx: number;
  regionIdx: number;
  regionCountByEffectiveName: Map<string, number>;
}): Region {
  const maybeRegionName = maybeGetRegionNameFromStartMatch(startMatch);
  const id = getUniqueRegionId({ maybeRegionName, regionCountByEffectiveName });
  // Create a placeholder range with start line; end will be updated when region is closed
  const placeholderRange = new vscode.Range(startLineIdx, 0, startLineIdx, 0);
  return {
    id,
    name: maybeRegionName,
    range: placeholderRange,
    regionIdx,
    wasClosed: false,
    children: [],
  };
}

function maybeGetRegionNameFromStartMatch(startMatch: RegExpMatchArray): string | undefined {
  const maybeTrimmedName = startMatch[1]?.trim();
  if (maybeTrimmedName === "" || maybeTrimmedName === undefined) {
    return undefined;
  }
  return maybeTrimmedName;
}

function getUniqueRegionId({
  maybeRegionName,
  regionCountByEffectiveName,
}: {
  maybeRegionName: string | undefined;
  regionCountByEffectiveName: Map<string, number>;
}): string {
  const effectiveRegionName = maybeRegionName ?? "unnamed";
  const newRegionCount = (regionCountByEffectiveName.get(effectiveRegionName) ?? 0) + 1;
  regionCountByEffectiveName.set(effectiveRegionName, newRegionCount);
  return `${effectiveRegionName}-${newRegionCount}`;
}

function addClosedChildrenToTopLevelRegions(region: Region, topLevelRegions: Region[]): void {
  for (const childRegion of region.children) {
    if (childRegion.wasClosed) {
      childRegion.parent = undefined;
      childRegion.regionIdx = topLevelRegions.length;
      topLevelRegions.push(childRegion);
      continue;
    }
    addClosedChildrenToTopLevelRegions(childRegion, topLevelRegions);
  }
}
