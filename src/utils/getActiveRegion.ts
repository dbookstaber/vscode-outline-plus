import * as vscode from "vscode";
import { type Region } from "../models/Region";

export function getActiveRegion(topLevelRegions: Region[]): Region | undefined {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return undefined;
  }
  return getActiveRegionInEditor(topLevelRegions, activeTextEditor);
}

export function getActiveRegionInEditor(
  topLevelRegions: Region[],
  activeTextEditor: vscode.TextEditor
): Region | undefined {
  const cursorLine = activeTextEditor.selection.active.line;
  return getActiveRegionAtLine(topLevelRegions, cursorLine);
}

export function getActiveRegionAtLine(regions: Region[], cursorLine: number): Region | undefined {
  let currentRegions = regions;
  let deepestMatch: Region | undefined;
  while (currentRegions.length > 0) {
    let found = false;
    for (const region of currentRegions) {
      if (cursorLine >= region.range.start.line && cursorLine <= region.range.end.line) {
        deepestMatch = region;
        currentRegions = region.children;
        found = true;
        break;
      }
    }
    if (!found) {
      break;
    }
  }
  return deepestMatch;
}
