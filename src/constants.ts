/**
 * Centralized constant definitions for Outline++.
 *
 * All command IDs, view IDs, configuration keys, workspace state keys,
 * and display names are defined here to prevent typos and ease refactoring.
 *
 * NOTE: Command IDs and view IDs must match exactly with their counterparts
 * in package.json — they cannot be derived at runtime.
 */

// #region Extension identity

export const EXTENSION_DISPLAY_NAME = "Outline++";
export const EXTENSION_CONFIG_NAMESPACE = "outlinePlus";

// #endregion

// #region View IDs (must match package.json contributes.views)

export const VIEW_ID_REGIONS = "outlinePlusRegionsView";
export const VIEW_ID_FULL_OUTLINE = "outlinePlusFullTreeView";

// #endregion

// #region Command IDs (must match package.json contributes.commands)

export const CMD_GO_TO_REGION_BOUNDARY = "outlinePlus.goToRegionBoundary";
export const CMD_SELECT_CURRENT_REGION = "outlinePlus.selectCurrentRegion";
export const CMD_GO_TO_REGION_FROM_QUICK_PICK = "outlinePlus.goToRegionFromQuickPick";
export const CMD_GO_TO_NEXT_REGION = "outlinePlus.goToNextRegion";
export const CMD_GO_TO_PREVIOUS_REGION = "outlinePlus.goToPreviousRegion";

export const CMD_REGIONS_VIEW_HIDE = "outlinePlus.regionsView.hide";
export const CMD_REGIONS_VIEW_SHOW = "outlinePlus.regionsView.show";
export const CMD_REGIONS_VIEW_RESET_AUTO_HIDE = "outlinePlus.regionsView.resetAutoHidePreference";
export const CMD_REGIONS_VIEW_STOP_AUTO_HIGHLIGHT = "outlinePlus.regionsView.stopAutoHighlightingActiveRegion";
export const CMD_REGIONS_VIEW_START_AUTO_HIGHLIGHT = "outlinePlus.regionsView.startAutoHighlightingActiveRegion";
export const CMD_REGIONS_VIEW_EXPAND_ALL = "outlinePlus.regionsView.expandAll";
export const CMD_REGIONS_VIEW_REFRESH = "outlinePlus.regionsView.refresh";

export const CMD_FULL_OUTLINE_VIEW_HIDE = "outlinePlus.fullOutlineView.hide";
export const CMD_FULL_OUTLINE_VIEW_SHOW = "outlinePlus.fullOutlineView.show";
export const CMD_FULL_OUTLINE_VIEW_STOP_AUTO_HIGHLIGHT = "outlinePlus.fullOutlineView.stopAutoHighlightingActiveItem";
export const CMD_FULL_OUTLINE_VIEW_START_AUTO_HIGHLIGHT = "outlinePlus.fullOutlineView.startAutoHighlightingActiveItem";
export const CMD_FULL_OUTLINE_VIEW_EXPAND_ALL = "outlinePlus.fullOutlineView.expandAll";
export const CMD_FULL_OUTLINE_VIEW_REFRESH = "outlinePlus.fullOutlineView.refresh";

export const CMD_GO_TO_REGION_TREE_ITEM = "outlinePlus.goToRegionTreeItem";
export const CMD_GO_TO_FULL_TREE_ITEM = "outlinePlus.goToFullTreeItem";

export const CMD_SHOW_DEBUG_LOG = "outlinePlus.showDebugLog";
export const CMD_DUMP_DIAGNOSTIC_STATE = "outlinePlus.dumpDiagnosticState";

// #endregion

// #region Configuration keys (relative to "outlinePlus" namespace)

export const CONFIG_KEY_ENABLE_DEBUG_LOGGING = "outlinePlus.enableDebugLogging";

// #endregion

// #region Workspace state keys

export const STATE_KEY_REGIONS_COLLAPSIBLE = "regionsViewCollapsibleStateStoreByDocumentId";
export const STATE_KEY_FULL_OUTLINE_COLLAPSIBLE = "fullOutlineViewCollapsibleStateStoreByDocumentId";
export const STATE_KEY_USER_WANTS_REGIONS_VIEW = "outlinePlus.userWantsRegionsView";

// #endregion

// #region Debounce timing (milliseconds)

/**
 * Debounce delay for document parsing operations (region parsing, symbol fetching).
 * These are the expensive operations that scan the full document.
 */
export const DEBOUNCE_DOCUMENT_PARSE_MS = 250;

/**
 * Debounce delay for cursor-tracking operations (active region/item detection).
 * These are lightweight searches through already-parsed data.
 */
export const DEBOUNCE_CURSOR_TRACKING_MS = 100;

/**
 * Debounce delay for tree view UI refresh after data changes.
 * Kept fast so tree views feel responsive after parsing completes.
 */
export const DEBOUNCE_TREE_REFRESH_MS = 100;

// #endregion
