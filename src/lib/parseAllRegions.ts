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
  /**
   * True when the file exceeded {@link LARGE_FILE_LINE_THRESHOLD} and region
   * parsing was skipped entirely. Callers surface this as a UX signal (a status
   * bar indicator) so an empty Regions view on a huge file is distinguishable
   * from "there are genuinely no regions" (plan 6.10).
   */
  bailedOutOnLargeFile: boolean;
};

// Bail out on very large files to keep the host responsive; full scan would
// blow past the parse debounce window and stall the UI thread.
export const LARGE_FILE_LINE_THRESHOLD = 100_000;

// A region marker is always a short comment line. Lines longer than this are
// never scanned for a boundary match. This is ReDoS defense-in-depth (plan
// 6.1): the shipped default patterns are linear, but users/workspaces can inject
// arbitrary `regionBoundaryPatternByLanguageId` regexes, and workspace-injected
// patterns are the one real attack surface (see capabilities.untrustedWorkspaces
// in the manifest). Capping the input length bounds the worst-case time any such
// pattern can spend on a single line. A marker on an over-long line is ignored:
// the least-surprising semantics, since a legitimate `#region` marker never
// approaches 500 characters (matches the behavior an over-long minified line
// would already have — no marker, no region).
export const MAX_REGION_MARKER_LINE_LENGTH = 500;

export function parseAllRegions(document: vscode.TextDocument): RegionParseResult {
  const topLevelRegions: Region[] = [];
  const invalidMarkers: InvalidMarker[] = [];
  const openRegionsStack: Region[] = [];

  if (document.lineCount > LARGE_FILE_LINE_THRESHOLD) {
    log(
      `parseAllRegions: skipping ${document.uri.toString()} (${document.lineCount} lines exceeds threshold ${LARGE_FILE_LINE_THRESHOLD})`
    );
    return { topLevelRegions, invalidMarkers, bailedOutOnLargeFile: true };
  }

  const { languageId } = document;
  const regionBoundaryPatternByLanguageId = getRegionBoundaryPatternMap();
  const regionBoundaryPattern = regionBoundaryPatternByLanguageId[languageId];
  if (regionBoundaryPattern === undefined) {
    return { topLevelRegions, invalidMarkers, bailedOutOnLargeFile: false };
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
  // Every region still open at EOF is an unclosed start: flag each one (order
  // outermost→innermost, preserving prior marker order).
  for (const openRegion of openRegionsStack) {
    invalidMarkers.push({ boundaryType: "start", lineIdx: openRegion.range.start.line });
  }
  attachUnclosedRegions(openRegionsStack, topLevelRegions, lineCount, lines);
  return { topLevelRegions, invalidMarkers, bailedOutOnLargeFile: false };
}

/**
 * Keeps unclosed regions visible and foldable instead of dropping them (plan
 * 6.10). Historically an unclosed region was discarded and only its *closed*
 * children were promoted to the top level, so the whole span vanished from the
 * tree even though it is still flagged invalid via an `InvalidMarker`. Instead,
 * represent each unclosed region as extending to its last closed child's end
 * (or EOF if it has no children), so the user still sees — and can fold — the
 * region while the diagnostic marks it invalid.
 *
 * The `openRegionsStack` runs outermost (bottom) → innermost (top). A region on
 * this stack never became a child of the one below it (parent links are only
 * formed on close), and any *closed* child of an outer region necessarily
 * closed before the inner region opened — so an inner unclosed region is always
 * textually the last thing inside its outer neighbour. Processing
 * innermost→outermost therefore lets each inner region's computed end propagate
 * into its parent's extent, and appending it as the parent's last child keeps
 * children in document order.
 */
function attachUnclosedRegions(
  openRegionsStack: Region[],
  topLevelRegions: Region[],
  lineCount: number,
  lines: string[]
): void {
  let extendedInnerRegion: Region | undefined;
  for (let i = openRegionsStack.length - 1; i >= 0; i--) {
    const openRegion = openRegionsStack[i];
    if (openRegion === undefined) {
      continue;
    }
    if (extendedInnerRegion !== undefined) {
      extendedInnerRegion.parent = openRegion;
      openRegion.children.push(extendedInnerRegion);
    }
    const endLineIdx = getUnclosedRegionEndLineIdx(openRegion, lineCount);
    openRegion.range = new vscode.Range(
      openRegion.range.start.line,
      0,
      endLineIdx,
      (lines[endLineIdx] ?? "").length
    );
    extendedInnerRegion = openRegion;
  }
  // The outermost unclosed region (last one processed) becomes a top-level
  // region. It is always textually after any already-closed top-level region,
  // so appending preserves document order.
  if (extendedInnerRegion !== undefined) {
    extendedInnerRegion.parent = undefined;
    extendedInnerRegion.regionIdx = topLevelRegions.length;
    topLevelRegions.push(extendedInnerRegion);
  }
}

/**
 * The line an unclosed region extends to: its last closed child's end line, or
 * the document's last line (EOF) when it has no children. Children are stored in
 * document order and never overlap, so the last child ends last.
 */
function getUnclosedRegionEndLineIdx(region: Region, lineCount: number): number {
  const lastChild = region.children[region.children.length - 1];
  if (lastChild !== undefined) {
    return lastChild.range.end.line;
  }
  return Math.max(0, lineCount - 1);
}

function matchLineWithRegexOrArray(
  lineText: string,
  regexOrArray: RegexOrArray
): RegExpMatchArray | null {
  // ReDoS defense-in-depth: never run a (possibly workspace-injected) region
  // pattern against a pathologically long line. See MAX_REGION_MARKER_LINE_LENGTH.
  if (lineText.length > MAX_REGION_MARKER_LINE_LENGTH) {
    return null;
  }
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
