import * as vscode from "vscode";
import { type RegionHelperAPI } from "./api/regionHelperAPI";
import { registerAllCommands } from "./commands/registerCommand";
import { createResetAutoHidePreferenceCommand } from "./commands/toggleRegionsViewSettings";
import { initializeExtensionContext } from "./config/extensionContext";
import { RegionDiagnosticsManager } from "./diagnostics/RegionDiagnosticsManager";
import { type FlattenedRegion } from "./lib/flattenRegions";
import { type InvalidMarker } from "./lib/parseAllRegions";
import { type Region } from "./models/Region";
import { CollapsibleStateManager } from "./state/CollapsibleStateManager";
import { DocumentSymbolStore } from "./state/DocumentSymbolStore";
import { FullOutlineStore } from "./state/FullOutlineStore";
import { RegionStore } from "./state/RegionStore";
import { RegionsViewAutoHideManager } from "./state/RegionsViewAutoHideManager";
import { type FullTreeItem } from "./treeView/fullTreeView/FullTreeItem";
import { FullTreeViewProvider } from "./treeView/fullTreeView/FullTreeViewProvider";
import { RegionTreeViewProvider } from "./treeView/regionTreeView/RegionTreeViewProvider";
import { dumpDiagnosticState, initializeDebugLog, showDebugLog } from "./utils/debugLog";
import { disposeHighlightDecorationType } from "./utils/highlightRegion";

export function activate(context: vscode.ExtensionContext): RegionHelperAPI {
  const { subscriptions, workspaceState, extensionPath } = context;
  
  // Store extension path for use by icon loading
  initializeExtensionContext(extensionPath);
  initializeDebugLog(subscriptions);
  
  const regionCollapsibleStateManager = new CollapsibleStateManager(
    workspaceState,
    "regionsViewCollapsibleStateStoreByDocumentId",
    subscriptions
  );
  const fullOutlineCollapsibleStateManager = new CollapsibleStateManager(
    workspaceState,
    "fullOutlineViewCollapsibleStateStoreByDocumentId",
    subscriptions
  );

  const regionStore = RegionStore.initialize(subscriptions);
  const documentSymbolStore = DocumentSymbolStore.initialize(subscriptions);
  const fullOutlineStore = FullOutlineStore.initialize(
    regionStore,
    documentSymbolStore,
    fullOutlineCollapsibleStateManager,
    subscriptions
  );

  const regionTreeViewProvider = new RegionTreeViewProvider(
    regionStore,
    regionCollapsibleStateManager,
    subscriptions
  );
  const regionTreeView = vscode.window.createTreeView("regionHelperRegionsView", {
    treeDataProvider: regionTreeViewProvider,
    showCollapseAll: true,
  });
  regionTreeViewProvider.setTreeView(regionTreeView, subscriptions);
  subscriptions.push(regionTreeView);

  // Initialize auto-hide manager for the REGIONS view
  const regionsViewAutoHideManager = new RegionsViewAutoHideManager(
    regionStore,
    workspaceState,
    subscriptions
  );
  regionsViewAutoHideManager.setTreeView(regionTreeView);
  subscriptions.push(regionsViewAutoHideManager);

  const fullTreeViewProvider = new FullTreeViewProvider(
    fullOutlineStore,
    fullOutlineCollapsibleStateManager,
    subscriptions
  );
  const fullTreeView = vscode.window.createTreeView("regionHelperFullTreeView", {
    treeDataProvider: fullTreeViewProvider,
    showCollapseAll: true,
  });
  fullTreeViewProvider.setTreeView(fullTreeView, subscriptions);
  subscriptions.push(fullTreeView);

  const regionDiagnosticsManager = new RegionDiagnosticsManager(regionStore, subscriptions);
  subscriptions.push(regionDiagnosticsManager.diagnostics);

  registerAllCommands(subscriptions, { regionStore, fullOutlineStore, regionTreeViewProvider, fullTreeViewProvider });

  // Register the reset auto-hide preference command
  const resetAutoHideCommand = vscode.commands.registerCommand(
    "regionHelper.regionsView.resetAutoHidePreference",
    createResetAutoHidePreferenceCommand(workspaceState)
  );
  subscriptions.push(resetAutoHideCommand);

  // Register debug commands
  subscriptions.push(
    vscode.commands.registerCommand("regionHelper.showDebugLog", () => {
      showDebugLog();
    }),
    vscode.commands.registerCommand("regionHelper.dumpDiagnosticState", () => {
      const activeEditor = vscode.window.activeTextEditor;
      dumpDiagnosticState({
        regionStoreVersionedDocId: regionStore.versionedDocumentId,
        documentSymbolStoreVersionedDocId: documentSymbolStore.versionedDocumentId,
        fullOutlineStoreVersionedDocId: fullOutlineStore.versionedDocumentId,
        fullOutlineStoreDocId: fullOutlineStore.documentId,
        activeEditorUri: activeEditor?.document.uri.toString(),
        activeEditorVersion: activeEditor?.document.version,
        regionCount: regionStore.flattenedRegions.length,
        symbolCount: documentSymbolStore.flattenedDocumentSymbols.length,
        fullOutlineItemCount: fullOutlineStore.topLevelFullOutlineItems.length,
      });
    })
  );

  return {
    // #region Region Store API
    // #region Getters
    getTopLevelRegions(): Region[] {
      return regionStore.topLevelRegions;
    },
    getFlattenedRegions(): FlattenedRegion[] {
      return regionStore.flattenedRegions;
    },
    getActiveRegion(): Region | undefined {
      return regionStore.activeRegion;
    },
    getInvalidMarkers(): InvalidMarker[] {
      return regionStore.invalidMarkers;
    },
    // #endregion
    // #region Events
    onDidChangeRegions: regionStore.onDidChangeRegions,
    onDidChangeActiveRegion: regionStore.onDidChangeActiveRegion,
    onDidChangeInvalidMarkers: regionStore.onDidChangeInvalidMarkers,
    // #endregion
    // #endregion
    // #region Full Outline Store API
    // #region Getters
    getTopLevelFullOutlineItems(): FullTreeItem[] {
      return fullOutlineStore.topLevelFullOutlineItems;
    },
    getActiveFullOutlineItem(): FullTreeItem | undefined {
      return fullOutlineStore.activeFullOutlineItem;
    },
    // #endregion
    // #region Events
    onDidChangeFullOutlineItems: fullOutlineStore.onDidChangeFullOutlineItems,
    onDidChangeActiveFullOutlineItem: fullOutlineStore.onDidChangeActiveFullOutlineItem,
    // #endregion
    // #endregion
  };
}

export function deactivate(): void {
  disposeHighlightDecorationType();
}
