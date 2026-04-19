import * as vscode from "vscode";
import { type OutlinePlusAPI } from "./api/regionHelperAPI";
import { registerAllCommands } from "./commands/registerCommand";
import { createResetAutoHidePreferenceCommand } from "./commands/toggleRegionsViewSettings";
import { initializeExtensionContext } from "./config/extensionContext";
import {
    CMD_DUMP_DIAGNOSTIC_STATE,
    CMD_REGIONS_VIEW_RESET_AUTO_HIDE,
    CMD_SHOW_DEBUG_LOG,
    STATE_KEY_FULL_OUTLINE_COLLAPSIBLE,
    STATE_KEY_REGIONS_COLLAPSIBLE,
    VIEW_ID_FULL_OUTLINE,
    VIEW_ID_REGIONS,
} from "./constants";
import { RegionDiagnosticsManager } from "./diagnostics/RegionDiagnosticsManager";
import { RegionFoldingProvider } from "./lib/RegionFoldingProvider";
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

export function activate(context: vscode.ExtensionContext): OutlinePlusAPI {
  const { subscriptions, workspaceState, extensionPath } = context;
  
  // Store extension path for use by icon loading
  initializeExtensionContext(extensionPath);
  initializeDebugLog(subscriptions);
  
  const regionCollapsibleStateManager = new CollapsibleStateManager(
    workspaceState,
    STATE_KEY_REGIONS_COLLAPSIBLE,
    subscriptions
  );
  const fullOutlineCollapsibleStateManager = new CollapsibleStateManager(
    workspaceState,
    STATE_KEY_FULL_OUTLINE_COLLAPSIBLE,
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
  const regionTreeView = vscode.window.createTreeView(VIEW_ID_REGIONS, {
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
  const fullTreeView = vscode.window.createTreeView(VIEW_ID_FULL_OUTLINE, {
    treeDataProvider: fullTreeViewProvider,
    showCollapseAll: true,
  });
  fullTreeViewProvider.setTreeView(fullTreeView, subscriptions);
  subscriptions.push(fullTreeView);

  const regionDiagnosticsManager = new RegionDiagnosticsManager(regionStore, subscriptions);
  subscriptions.push(regionDiagnosticsManager.diagnostics);

  registerAllCommands(subscriptions, { regionStore, fullOutlineStore, regionTreeViewProvider, fullTreeViewProvider });

  // Register folding range provider for region markers
  const foldingProvider = new RegionFoldingProvider();
  subscriptions.push(
    vscode.languages.registerFoldingRangeProvider({ scheme: "file" }, foldingProvider),
    vscode.languages.registerFoldingRangeProvider({ scheme: "untitled" }, foldingProvider)
  );

  // Register the reset auto-hide preference command
  const resetAutoHideCommand = vscode.commands.registerCommand(
    CMD_REGIONS_VIEW_RESET_AUTO_HIDE,
    createResetAutoHidePreferenceCommand(workspaceState)
  );
  subscriptions.push(resetAutoHideCommand);

  // Register debug commands
  subscriptions.push(
    vscode.commands.registerCommand(CMD_SHOW_DEBUG_LOG, () => {
      showDebugLog();
    }),
    vscode.commands.registerCommand(CMD_DUMP_DIAGNOSTIC_STATE, () => {
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
