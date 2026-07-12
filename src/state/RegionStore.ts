import * as vscode from "vscode";
import { DEBOUNCE_CURSOR_TRACKING_MS, DEBOUNCE_DOCUMENT_PARSE_MS } from "../constants";
import { isIgnoredDocumentScheme } from "../lib/documentScheme";
import { type FlattenedRegion, flattenRegionsAndCountParents } from "../lib/flattenRegions";
import {
  extractDocumentIdFromVersioned,
  getDocumentId,
  getVersionedDocumentId,
} from "../lib/getVersionedDocumentId";
import { type InvalidMarker, parseAllRegions } from "../lib/parseAllRegions";
import { type Region } from "../models/Region";
import { type DebouncedFunction, debounce } from "../utils/debounce";
import { log } from "../utils/debugLog";
import { getActiveRegion } from "../utils/getActiveRegion";

/** A cached region-parse result for one URI+version (plan 4.6b). */
type CachedRegionParse = {
  topLevelRegions: Region[];
  flattenedRegions: FlattenedRegion[];
  allParentIds: Set<string>;
  invalidMarkers: InvalidMarker[];
  bailedOutOnLargeFile: boolean;
};

export class RegionStore implements vscode.Disposable {
  // #region Public properties
  private _topLevelRegions: Region[] = [];
  private _flattenedRegions: FlattenedRegion[] = [];
  private _onDidChangeRegions = new vscode.EventEmitter<void>();
  readonly onDidChangeRegions = this._onDidChangeRegions.event;
  get topLevelRegions(): Region[] {
    return this._topLevelRegions;
  }
  get flattenedRegions(): FlattenedRegion[] {
    return this._flattenedRegions;
  }

  private _allParentIds: Set<string> = new Set<string>();
  get allParentIds(): Set<string> {
    return this._allParentIds;
  }

  private _activeRegion: Region | undefined = undefined;
  private _onDidChangeActiveRegion = new vscode.EventEmitter<void>();
  readonly onDidChangeActiveRegion = this._onDidChangeActiveRegion.event;
  get activeRegion(): Region | undefined {
    return this._activeRegion;
  }

  private _invalidMarkers: InvalidMarker[] = [];
  private _onDidChangeInvalidMarkers = new vscode.EventEmitter<void>();
  readonly onDidChangeInvalidMarkers = this._onDidChangeInvalidMarkers.event;
  get invalidMarkers(): InvalidMarker[] {
    return this._invalidMarkers;
  }

  /**
   * True while the active document exceeded the parser's large-file line
   * threshold and region parsing was skipped (plan 6.10). Surfaced as a UX
   * signal so an empty Regions view on a huge file is distinguishable from
   * "there are genuinely no regions". `onDidChangeLargeFileBailout` fires only
   * when this transitions.
   */
  private _didBailOutOnLargeFile = false;
  private _onDidChangeLargeFileBailout = new vscode.EventEmitter<void>();
  readonly onDidChangeLargeFileBailout = this._onDidChangeLargeFileBailout.event;
  get didBailOutOnLargeFile(): boolean {
    return this._didBailOutOnLargeFile;
  }

  private _documentId: string | undefined = undefined;
  get documentId(): string | undefined {
    return this._documentId;
  }

  private _versionedDocumentId: string | undefined = undefined;
  get versionedDocumentId(): string | undefined {
    return this._versionedDocumentId;
  }
  // #endregion

  /**
   * Per-URI+version LRU cache of parse results (plan 4.6b). The version
   * short-circuit in {@link refreshRegions} only avoids reparsing while the
   * active document stays put; an A→B→A tab switch lands on A at its original
   * (unchanged) version but with `_versionedDocumentId` now pointing at B, so
   * without this cache A would be reparsed from scratch. Keyed by
   * `versionedDocumentId`, so an edit (new version) is a natural cache miss.
   *
   * Safe to store the parsed trees directly: `parseAllRegions` returns fresh
   * objects each call and nothing mutates a Region after parse
   * ({@link flattenRegionsAndCountParents} shallow-copies).
   *
   * The version-keyed entry assumes a given `uri@version` always denotes the
   * same content. That holds while a document stays open, but VS Code resets
   * the version counter when a document is closed and later reopened — so an
   * external edit made while the file was closed could collide with a stale
   * entry. All of a document's entries are therefore evicted on
   * `onDidCloseTextDocument`. (Tab switches don't close documents, so the
   * A→B→A reuse this cache exists for is unaffected.)
   *
   * A version-keyed entry also assumes the parse *rules* are fixed. A change to
   * the region-boundary-pattern config reparses every document under new rules
   * at the same `uri@version`, so {@link refreshRegionsForced} (the nuclear
   * option wired to that config change) clears the entire cache — otherwise an
   * A→B→A switch after the change would serve A's pre-change parse.
   */
  private readonly _parseCache = new Map<string, CachedRegionParse>();
  private static readonly PARSE_CACHE_CAP = 50;

  private debouncedRefreshRegionsAndActiveRegion: DebouncedFunction<() => void> = debounce(
    this.refreshRegionsAndActiveRegion.bind(this),
    DEBOUNCE_DOCUMENT_PARSE_MS
  );

  private debouncedRefreshActiveRegion: DebouncedFunction<() => void> = debounce(
    this.refreshActiveRegion.bind(this),
    DEBOUNCE_CURSOR_TRACKING_MS
  );

  constructor(subscriptions: vscode.Disposable[]) {
    this.registerListeners(subscriptions);
    this.debouncedRefreshRegionsAndActiveRegion();
  }

  dispose(): void {
    this.debouncedRefreshRegionsAndActiveRegion.cancel();
    this.debouncedRefreshActiveRegion.cancel();
    this._onDidChangeRegions.dispose();
    this._onDidChangeActiveRegion.dispose();
    this._onDidChangeInvalidMarkers.dispose();
    this._onDidChangeLargeFileBailout.dispose();
  }

  /** Updates the large-file bailout flag, firing the event only on a transition. */
  private updateLargeFileBailout(didBailOut: boolean): void {
    if (this._didBailOutOnLargeFile === didBailOut) {
      return;
    }
    this._didBailOutOnLargeFile = didBailOut;
    this._onDidChangeLargeFileBailout.fire();
  }

  /**
   * Forces an immediate refresh of regions for the active editor,
   * bypassing change-detection so the event always fires.
   */
  forceRefresh(): void {
    this.debouncedRefreshRegionsAndActiveRegion.cancel();
    this.refreshRegionsForced();
    this.refreshActiveRegion();
  }

  private refreshRegionsForced(): void {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const activeDocumentId = activeDocument ? getDocumentId(activeDocument) : undefined;
    const versionedDocumentId = activeDocument ? getVersionedDocumentId(activeDocument) : undefined;

    // forceRefresh is the nuclear option — its main trigger is a
    // region-boundary-pattern config change, which invalidates the parse of
    // EVERY cached document (not just the active one) since the parse rules
    // themselves changed. Drop the whole cache so a later A→B→A tab switch
    // reparses under the new rules instead of serving a stale pre-change entry.
    this._parseCache.clear();

    if (!activeDocument) {
      this._topLevelRegions = [];
      this._flattenedRegions = [];
      this._invalidMarkers = [];
      this._allParentIds = new Set<string>();
      this.updateLargeFileBailout(false);
    } else {
      const { topLevelRegions, invalidMarkers, bailedOutOnLargeFile } =
        parseAllRegions(activeDocument);
      this._topLevelRegions = topLevelRegions;
      const { flattenedRegions, allParentIds } = flattenRegionsAndCountParents(topLevelRegions);
      this._flattenedRegions = flattenedRegions;
      this._allParentIds = allParentIds;
      this._invalidMarkers = invalidMarkers;
      this.updateLargeFileBailout(bailedOutOnLargeFile);
      // Re-seed the cache with this fresh parse so an immediate tab switch away
      // and back reuses it rather than reparsing.
      if (versionedDocumentId !== undefined) {
        this.setCachedParse(versionedDocumentId, {
          topLevelRegions,
          flattenedRegions,
          allParentIds,
          invalidMarkers,
          bailedOutOnLargeFile,
        });
      }
    }
    this._documentId = activeDocumentId;
    this._versionedDocumentId = versionedDocumentId;

    // Always fire on force refresh, even if no change detected
    this._onDidChangeRegions.fire();
    this._onDidChangeInvalidMarkers.fire();
  }

  private registerListeners(subscriptions: vscode.Disposable[]): void {
    vscode.window.onDidChangeActiveTextEditor(
      this.debouncedRefreshRegionsAndActiveRegion,
      undefined,
      subscriptions
    );
    vscode.workspace.onDidChangeTextDocument(
      this.onDocumentChange.bind(this),
      undefined,
      subscriptions
    );
    vscode.window.onDidChangeTextEditorSelection(
      this.onSelectionChange.bind(this),
      undefined,
      subscriptions
    );
    vscode.workspace.onDidCloseTextDocument(
      (document) => this.evictCachedParses(getDocumentId(document)),
      undefined,
      subscriptions
    );
  }

  /** Drops every cached parse for a document (all versions). */
  private evictCachedParses(documentId: string): void {
    for (const key of this._parseCache.keys()) {
      if (extractDocumentIdFromVersioned(key) === documentId) {
        this._parseCache.delete(key);
      }
    }
  }

  private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (vscode.window.activeTextEditor?.document === event.document) {
      this.debouncedRefreshActiveRegion.cancel();
      this.debouncedRefreshRegionsAndActiveRegion();
    }
  }

  private refreshRegionsAndActiveRegion(): void {
    this.refreshRegions();
    this.refreshActiveRegion();
  }

  private refreshRegions(): void {
    const activeDocument = vscode.window.activeTextEditor?.document;

    // Plan 4.7a: activeTextEditor becomes undefined on a *transient* focus loss
    // (focusing a webview/Output panel, a tab switch in progress). Clearing +
    // firing here made the Regions view (and, downstream, the Full Outline)
    // flash empty and reparse on every editor↔webview round trip. Retain
    // last-known regions instead; a switch to a *different* real editor
    // (document defined) still replaces them below.
    if (!activeDocument) {
      return;
    }

    // Plan 4.7b: never run parseAllRegions over an ignored-scheme document (e.g.
    // the Output panel) on focus change — retain last-known regions.
    if (isIgnoredDocumentScheme(activeDocument)) {
      return;
    }

    const activeDocumentId = getDocumentId(activeDocument);
    const versionedDocumentId = getVersionedDocumentId(activeDocument);

    // Same versioned id ⇒ same doc revision ⇒ region parse guaranteed
    // identical; skip the reparse + deep-equality walk entirely.
    if (versionedDocumentId === this._versionedDocumentId) {
      return;
    }

    const oldFlattenedRegions = this._flattenedRegions;
    const oldInvalidMarkers = this._invalidMarkers;

    // Plan 4.6b: reuse a cached parse for this exact URI+version if we have one
    // (an A→B→A tab switch), otherwise parse and cache the result.
    const cached = this.getCachedParse(versionedDocumentId);
    if (cached !== undefined) {
      this._topLevelRegions = cached.topLevelRegions;
      this._flattenedRegions = cached.flattenedRegions;
      this._allParentIds = cached.allParentIds;
      this._invalidMarkers = cached.invalidMarkers;
      this.updateLargeFileBailout(cached.bailedOutOnLargeFile);
    } else {
      const { topLevelRegions, invalidMarkers, bailedOutOnLargeFile } =
        parseAllRegions(activeDocument);
      const { flattenedRegions, allParentIds } = flattenRegionsAndCountParents(topLevelRegions);
      this._topLevelRegions = topLevelRegions;
      this._flattenedRegions = flattenedRegions;
      this._allParentIds = allParentIds;
      this._invalidMarkers = invalidMarkers;
      this.updateLargeFileBailout(bailedOutOnLargeFile);
      this.setCachedParse(versionedDocumentId, {
        topLevelRegions,
        flattenedRegions,
        allParentIds,
        invalidMarkers,
        bailedOutOnLargeFile,
      });
    }
    this._documentId = activeDocumentId;
    this._versionedDocumentId = versionedDocumentId;

    // Only fire events if the data actually changed
    if (didFlattenedRegionsChange(oldFlattenedRegions, this._flattenedRegions)) {
      log(`RegionStore: regions changed (${this._flattenedRegions.length} regions, ${versionedDocumentId})`);
      this._onDidChangeRegions.fire();
    }
    if (didInvalidMarkersChange(oldInvalidMarkers, this._invalidMarkers)) {
      this._onDidChangeInvalidMarkers.fire();
    }
  }

  // #region Parse cache (plan 4.6b)
  /** Reads a cached parse and marks it most-recently-used. */
  private getCachedParse(versionedDocumentId: string): CachedRegionParse | undefined {
    const cached = this._parseCache.get(versionedDocumentId);
    if (cached !== undefined) {
      // Re-insert to move this key to the most-recently-used end.
      this._parseCache.delete(versionedDocumentId);
      this._parseCache.set(versionedDocumentId, cached);
    }
    return cached;
  }

  /** Stores a parse result, evicting the least-recently-used entry past the cap. */
  private setCachedParse(versionedDocumentId: string, parse: CachedRegionParse): void {
    this._parseCache.delete(versionedDocumentId);
    this._parseCache.set(versionedDocumentId, parse);
    if (this._parseCache.size > RegionStore.PARSE_CACHE_CAP) {
      const oldestKey = this._parseCache.keys().next().value;
      if (oldestKey !== undefined) {
        this._parseCache.delete(oldestKey);
      }
    }
  }
  // #endregion

  // #region Refresh active region on selection change
  private onSelectionChange(event: vscode.TextEditorSelectionChangeEvent): void {
    if (event.textEditor === vscode.window.activeTextEditor) {
      this.debouncedRefreshActiveRegion();
    }
  }

  private refreshActiveRegion(): void {
    this.debouncedRefreshActiveRegion.cancel();
    const oldActiveRegion = this._activeRegion;
    this._activeRegion = getActiveRegion(this._topLevelRegions);
    // Structural comparison (not reference): regions are rebuilt from scratch on
    // every reparse, so a reference compare fires onDidChangeActiveRegion after
    // every rebuild even when the active region is unchanged — the mirror of the
    // FullOutlineStore over-fire (plan 2.9). Compare by id + range so the event
    // fires only on a genuine active-region change.
    if (!isSameActiveRegion(oldActiveRegion, this._activeRegion)) {
      this._onDidChangeActiveRegion.fire();
    }
  }
  // #endregion
}

// #region Change detection helpers

/**
 * Structural identity for the *active* region: same logical region at the same
 * position. Used to decide whether to fire onDidChangeActiveRegion. Reference
 * equality is unusable because region objects are rebuilt on every reparse; two
 * objects representing the same region share an id and range.
 */
function isSameActiveRegion(a: Region | undefined, b: Region | undefined): boolean {
  if (a === b) {
    return true;
  }
  if (a === undefined || b === undefined) {
    return false;
  }
  return a.id === b.id && a.range.isEqual(b.range);
}

function didFlattenedRegionsChange(
  oldFlattenedRegions: FlattenedRegion[],
  newFlattenedRegions: FlattenedRegion[]
): boolean {
  if (oldFlattenedRegions.length !== newFlattenedRegions.length) {
    return true;
  }
  for (let i = 0; i < oldFlattenedRegions.length; i++) {
    const oldFlattenedRegion = oldFlattenedRegions[i];
    const newFlattenedRegion = newFlattenedRegions[i];
    if (
      oldFlattenedRegion &&
      newFlattenedRegion &&
      !areFlattenedRegionsEqual(oldFlattenedRegion, newFlattenedRegion)
    ) {
      return true;
    }
  }
  return false;
}

function areFlattenedRegionsEqual(region1: FlattenedRegion, region2: FlattenedRegion): boolean {
  return (
    region1.flatRegionIdx === region2.flatRegionIdx &&
    region1.name === region2.name &&
    region1.range.isEqual(region2.range) &&
    region1.wasClosed === region2.wasClosed
  );
}

function didInvalidMarkersChange(
  oldMarkers: InvalidMarker[],
  newMarkers: InvalidMarker[]
): boolean {
  if (oldMarkers.length !== newMarkers.length) {
    return true;
  }
  for (let i = 0; i < oldMarkers.length; i++) {
    const oldMarker = oldMarkers[i];
    const newMarker = newMarkers[i];
    if (
      oldMarker &&
      newMarker &&
      (oldMarker.boundaryType !== newMarker.boundaryType || oldMarker.lineIdx !== newMarker.lineIdx)
    ) {
      return true;
    }
  }
  return false;
}

// #endregion
