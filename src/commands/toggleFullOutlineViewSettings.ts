import * as vscode from "vscode";

import {
    getGlobalFullOutlineViewConfigValue,
    setGlobalFullOutlineViewConfigValue,
} from "../config/fullOutlineViewConfig";
import {
    CMD_FULL_OUTLINE_VIEW_HIDE,
    CMD_FULL_OUTLINE_VIEW_SHOW,
    CMD_FULL_OUTLINE_VIEW_START_AUTO_HIGHLIGHT,
    CMD_FULL_OUTLINE_VIEW_STOP_AUTO_HIGHLIGHT,
} from "../constants";
import { type OutlinePlusNonClosuredCommand } from "./registerCommand";

// #region Exported commands

const hideFullOutlineViewCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_HIDE,
  callback: hideFullOutlineView,
  needsRegionHelperParams: false,
};

const showFullOutlineViewCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_SHOW,
  callback: showFullOutlineView,
  needsRegionHelperParams: false,
};

const stopAutoHighlightingActiveItemCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_STOP_AUTO_HIGHLIGHT,
  callback: stopAutoHighlightingActiveItem,
  needsRegionHelperParams: false,
};

const startAutoHighlightingActiveItemCommand: OutlinePlusNonClosuredCommand = {
  id: CMD_FULL_OUTLINE_VIEW_START_AUTO_HIGHLIGHT,
  callback: startAutoHighlightingActiveItem,
  needsRegionHelperParams: false,
};

export const allFullOutlineViewConfigCommands = [
  hideFullOutlineViewCommand,
  showFullOutlineViewCommand,
  stopAutoHighlightingActiveItemCommand,
  startAutoHighlightingActiveItemCommand,
];

// #endregion

// #region Command implementations

function hideFullOutlineView(): void {
  const isAlreadyVisible = getGlobalFullOutlineViewConfigValue("isVisible");
  if (!isAlreadyVisible) {
    vscode.window.showInformationMessage("Outline++: Full Outline view is already hidden.");
    return;
  }
  void setGlobalFullOutlineViewConfigValue("isVisible", false);
}

function showFullOutlineView(): void {
  const isAlreadyVisible = getGlobalFullOutlineViewConfigValue("isVisible");
  if (isAlreadyVisible) {
    vscode.window.showInformationMessage("Outline++: Full Outline view is already visible.");
    return;
  }
  void setGlobalFullOutlineViewConfigValue("isVisible", true);
}

function stopAutoHighlightingActiveItem(): void {
  const isAlreadyAutoHighlightingActiveItem = getGlobalFullOutlineViewConfigValue(
    "shouldAutoHighlightActiveItem"
  );
  if (!isAlreadyAutoHighlightingActiveItem) {
    vscode.window.showInformationMessage(
      "Outline++: Full Outline view is already not auto-highlighting the active item."
    );
    return;
  }
  void setGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem", false);
}

function startAutoHighlightingActiveItem(): void {
  const isAlreadyAutoHighlightingActiveItem = getGlobalFullOutlineViewConfigValue(
    "shouldAutoHighlightActiveItem"
  );
  if (isAlreadyAutoHighlightingActiveItem) {
    vscode.window.showInformationMessage(
      "Outline++: Full Outline view is already auto-highlighting the active item."
    );
    return;
  }
  void setGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem", true);
}

// #endregion
