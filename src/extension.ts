import * as vscode from "vscode";
import { type OutlineItem, type OutlinePlusAPI, toOutlineItem } from "./api/regionHelperAPI";
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
import { registerRegionBoundaryPatternConfigListener } from "./lib/regionBoundaryPatterns";
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

/**
 * Pending workspace-state flushes that must complete before extension teardown.
 * Populated during `activate()` and awaited in `deactivate()`. VSCode awaits the
 * promise returned from `deactivate()`, so this prevents fire-and-forget writes
 * (collapsible state, user view preference) from being cut off mid-write on
 * shutdown — see CollapsibleStateManager.flush / RegionsViewAutoHideManager.flush.
 */
const pendingDeactivateFlushes: (() => Promise<void>)[] = [];

export function activate(context: vscode.ExtensionContext): OutlinePlusAPI {
  const { subscriptions, workspaceState, extensionPath } = context;

  // Defensive reset: if the host activates twice without an intervening
  // deactivate (uncommon, but possible in extension-development hot reload),
  // drop any stale flushes from the prior activation so we don't double-flush
  // disposed managers.
  pendingDeactivateFlushes.length = 0;

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
  pendingDeactivateFlushes.push(() => regionCollapsibleStateManager.flush());
  pendingDeactivateFlushes.push(() => fullOutlineCollapsibleStateManager.flush());

  const regionStore = new RegionStore(subscriptions);
  subscriptions.push(regionStore);
  const documentSymbolStore = new DocumentSymbolStore(subscriptions);
  subscriptions.push(documentSymbolStore);
  const fullOutlineStore = new FullOutlineStore(
    regionStore,
    documentSymbolStore,
    fullOutlineCollapsibleStateManager,
    subscriptions
  );
  subscriptions.push(fullOutlineStore);

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
  pendingDeactivateFlushes.push(() => regionsViewAutoHideManager.flush());

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
  const foldingProvider = new RegionFoldingProvider(regionStore);
  subscriptions.push(
    vscode.languages.registerFoldingRangeProvider({ scheme: "file" }, foldingProvider),
    vscode.languages.registerFoldingRangeProvider({ scheme: "untitled" }, foldingProvider)
  );

  // Re-parse when the user edits regionBoundaryPatternByLanguageId so changes take effect
  // without requiring an extension reload.
  registerRegionBoundaryPatternConfigListener(subscriptions, () => {
    regionStore.forceRefresh();
  });

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

  // Internal-only handle for integration tests that need access to runtime
  // objects (e.g. FullTreeItem.modifiers) which the public API intentionally
  // strips at the boundary. Not part of `OutlinePlusAPI` and not documented.
  // Cross-bundle: tests cannot reach the FullOutlineStore instance directly
  // because the test webpack bundle ships its own module copy of the class.
  const internalHandle = {
    _test_getInternalFullOutlineItems: (): FullTreeItem[] =>
      fullOutlineStore.topLevelFullOutlineItems,
  };

  return {
    ...internalHandle,
    apiVersion: "1.0",
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
    getTopLevelFullOutlineItems(): OutlineItem[] {
      return fullOutlineStore.topLevelFullOutlineItems.map(toOutlineItem);
    },
    getActiveFullOutlineItem(): OutlineItem | undefined {
      const active = fullOutlineStore.activeFullOutlineItem;
      return active ? toOutlineItem(active) : undefined;
    },
    // #endregion
    // #region Events
    onDidChangeFullOutlineItems: fullOutlineStore.onDidChangeFullOutlineItems,
    onDidChangeActiveFullOutlineItem: fullOutlineStore.onDidChangeActiveFullOutlineItem,
    // #endregion
    // #endregion
  };
}

export async function deactivate(): Promise<void> {
  disposeHighlightDecorationType();
  // Flush pending workspace-state writes that would otherwise race extension-host
  // teardown. VSCode awaits the promise returned from deactivate(), so as long as
  // we await here, the user's collapse/expand state and view preference are
  // guaranteed persisted before the host exits.
  const flushes = pendingDeactivateFlushes.splice(0);
  await Promise.allSettled(flushes.map((fn) => fn()));
}
