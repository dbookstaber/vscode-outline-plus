import * as vscode from "vscode";
import {
    getGlobalRegionsViewConfigValue,
    setGlobalRegionsViewConfigValue,
    setRegionsViewVisibility,
} from "../config/regionsViewConfig";
import { type OutlinePlusNonClosuredCommand } from "./registerCommand";

/** Key used by RegionsViewAutoHideManager to persist user preference */
const USER_WANTS_REGIONS_VIEW_KEY = "outlinePlus.userWantsRegionsView";

// #region Exported commands

const hideRegionsViewCommand: OutlinePlusNonClosuredCommand = {
  id: "outlinePlus.regionsView.hide",
  callback: hideRegionsView,
  needsRegionHelperParams: false,
};

const showRegionsViewCommand: OutlinePlusNonClosuredCommand = {
  id: "outlinePlus.regionsView.show",
  callback: showRegionsView,
  needsRegionHelperParams: false,
};

const stopAutoHighlightingActiveRegionCommand: OutlinePlusNonClosuredCommand = {
  id: "outlinePlus.regionsView.stopAutoHighlightingActiveRegion",
  callback: stopAutoHighlightingActiveRegion,
  needsRegionHelperParams: false,
};

const startAutoHighlightingActiveRegionCommand: OutlinePlusNonClosuredCommand = {
  id: "outlinePlus.regionsView.startAutoHighlightingActiveRegion",
  callback: startAutoHighlightingActiveRegion,
  needsRegionHelperParams: false,
};

export const allRegionsViewConfigCommands: OutlinePlusNonClosuredCommand[] = [
  hideRegionsViewCommand,
  showRegionsViewCommand,
  stopAutoHighlightingActiveRegionCommand,
  startAutoHighlightingActiveRegionCommand,
];

// #endregion

// #region Command implementations

function hideRegionsView(): void {
  const isAlreadyVisible = getGlobalRegionsViewConfigValue("isVisible");
  if (!isAlreadyVisible) {
    vscode.window.showInformationMessage("Outline++: Regions view is already hidden.");
    return;
  }
  void setRegionsViewVisibility(false);
}

function showRegionsView(): void {
  const isAlreadyVisible = getGlobalRegionsViewConfigValue("isVisible");
  if (isAlreadyVisible) {
    vscode.window.showInformationMessage("Outline++: Regions view is already visible.");
    return;
  }
  void setRegionsViewVisibility(true);
}

function stopAutoHighlightingActiveRegion(): void {
  void setGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion", false);
}

function startAutoHighlightingActiveRegion(): void {
  void setGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion", true);
}

// #endregion

// #region Reset command - exposed for extension.ts to use

/**
 * Resets the auto-hide user preference in workspace state.
 * This is called by the extension when registering the reset command.
 */
export function createResetAutoHidePreferenceCommand(
  workspaceState: vscode.Memento
): () => Promise<void> {
  return async (): Promise<void> => {
    // Reset the user preference to true (wants to see the view)
    await workspaceState.update(USER_WANTS_REGIONS_VIEW_KEY, true);
    // Also show the view immediately
    await setGlobalRegionsViewConfigValue("isVisible", true);
    vscode.window.showInformationMessage(
      "Outline++: Auto-hide preference has been reset. The Regions view will now auto-show when you open files with regions."
    );
  };
}

// #endregion
