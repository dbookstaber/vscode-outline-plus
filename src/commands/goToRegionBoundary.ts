import * as vscode from "vscode";
import { goToNextTopLevelRegionBoundary } from "../lib/goToNextTopLevelRegionBoundary";
import { type Region } from "../models/Region";
import { moveCursorToFirstNonWhitespaceCharOfLine } from "../utils/editorNav";
import { showRegionCommandNoOp } from "./regionCommandFeedback";
import { type OutlinePlusClosuredParams } from "./registerCommand";

export function goToRegionBoundary({ regionStore }: OutlinePlusClosuredParams): void {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    showRegionCommandNoOp("noEditor");
    return;
  }
  const cursorLine = activeTextEditor.selection.active.line;
  const { topLevelRegions, activeRegion } = regionStore;
  if (!activeRegion) {
    // With no enclosing region, the command jumps to the next top-level region
    // boundary below the cursor. Detect the no-op cases up front so we can name
    // why nothing happened instead of silently doing nothing (plan 6.7).
    const hasBoundaryBelowCursor = topLevelRegions.some(
      (region) => region.range.start.line > cursorLine
    );
    if (!hasBoundaryBelowCursor) {
      showRegionCommandNoOp(topLevelRegions.length === 0 ? "noRegions" : "cursorOutsideRegion");
      return;
    }
    goToNextTopLevelRegionBoundary({
      activeTextEditor,
      topLevelRegions,
      cursorLine,
      revealType: vscode.TextEditorRevealType.Default,
    });
    return;
  }
  const regionBoundaryLineIdx = getRegionBoundaryLineForJump(activeRegion, cursorLine);
  moveCursorToFirstNonWhitespaceCharOfLine({
    activeTextEditor,
    lineIdx: regionBoundaryLineIdx,
    revealType: vscode.TextEditorRevealType.Default,
  });
}

function getRegionBoundaryLineForJump(activeRegion: Region, cursorLine: number): number {
  const startLineIdx = activeRegion.range.start.line;
  const endLineIdx = activeRegion.range.end.line;
  if (cursorLine === startLineIdx) {
    return endLineIdx;
  }
  if (cursorLine === endLineIdx) {
    return startLineIdx;
  }
  return endLineIdx;
}
