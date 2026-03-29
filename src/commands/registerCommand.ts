import * as vscode from "vscode";
import { type FullOutlineStore } from "../state/FullOutlineStore";
import { type RegionStore } from "../state/RegionStore";
import { type FullTreeViewProvider } from "../treeView/fullTreeView/FullTreeViewProvider";
import { goToFullTreeItemCommand } from "../treeView/fullTreeView/goToFullTreeItem";
import { goToRegionTreeItemCommand } from "../treeView/regionTreeView/goToRegionTreeItem";
import { type RegionTreeViewProvider } from "../treeView/regionTreeView/RegionTreeViewProvider";
import { allExpandAllCommands } from "./expandAndCollapseAll";
import { goToNextRegionCommand } from "./goToNextRegion";
import { goToPreviousRegionCommand } from "./goToPreviousRegion";
import { goToRegionBoundaryCommand } from "./goToRegionBoundary";
import { goToRegionFromQuickPickCommand } from "./goToRegionFromQuickPick";
import { allRefreshCommands } from "./refreshViews";
import { selectCurrentRegionCommand } from "./selectCurrentRegion";
import { allFullOutlineViewConfigCommands } from "./toggleFullOutlineViewSettings";
import { allRegionsViewConfigCommands } from "./toggleRegionsViewSettings";

type OutlinePlusExtensionId = "outlinePlus";

type OutlinePlusCommandId = `${OutlinePlusExtensionId}.${string}`;

export type OutlinePlusClosuredParams = {
  regionStore: RegionStore;
  fullOutlineStore: FullOutlineStore;
  regionTreeViewProvider: RegionTreeViewProvider;
  fullTreeViewProvider: FullTreeViewProvider;
};

/** A command that needs access to OutlinePlusClosuredParams. */
export type OutlinePlusClosuredCommand = {
  id: OutlinePlusCommandId;
  callback: (outlinePlusParams: OutlinePlusClosuredParams) => void;
  needsRegionHelperParams: true;
};

/** A command that doesn't need access to OutlinePlusClosuredParams. */
export type OutlinePlusNonClosuredCommand = {
  id: OutlinePlusCommandId;
  callback: Parameters<typeof vscode.commands.registerCommand>[1];
  needsRegionHelperParams: false;
};

type OutlinePlusCommand = OutlinePlusClosuredCommand | OutlinePlusNonClosuredCommand;

export function registerAllCommands(
  subscriptions: vscode.Disposable[],
  outlinePlusParams: OutlinePlusClosuredParams
): void {
  for (const command of commandsToRegister) {
    registerOutlinePlusCommand(command, subscriptions, outlinePlusParams);
  }
}

const commandsToRegister: OutlinePlusCommand[] = [
  goToRegionTreeItemCommand,
  goToFullTreeItemCommand,
  goToRegionBoundaryCommand,
  selectCurrentRegionCommand,
  goToRegionFromQuickPickCommand,
  goToNextRegionCommand,
  goToPreviousRegionCommand,
  ...allRegionsViewConfigCommands,
  ...allFullOutlineViewConfigCommands,
  ...allExpandAllCommands,
  ...allRefreshCommands,
];

function registerOutlinePlusCommand(
  command: OutlinePlusCommand,
  subscriptions: vscode.Disposable[],
  outlinePlusParams: OutlinePlusClosuredParams
): void {
  const { id, callback, needsRegionHelperParams } = command;
  const commandDisposable = vscode.commands.registerCommand(
    id,
    needsRegionHelperParams ? (): void => callback(outlinePlusParams) : callback
  );
  subscriptions.push(commandDisposable);
}
