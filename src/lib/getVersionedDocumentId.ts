import * as vscode from "vscode";

export function isCurrentActiveVersionedDocumentId(
  versionedDocumentId: string | undefined
): boolean {
  const currentActiveDocumentId = getCurrentActiveVersionedDocumentId();
  return currentActiveDocumentId === versionedDocumentId;
}

/**
 * Compares a store's (un-versioned) documentId against the active editor's
 * documentId — i.e. same document, ignoring version.
 *
 * The auto-highlight reveal gate uses this rather than
 * {@link isCurrentActiveVersionedDocumentId} so that outline-neutral edits
 * (which bump the document version without producing any store event, leaving
 * the store's versioned id lagging the editor) do not permanently suppress
 * reveals. The gate still blocks cross-document reveals — its actual purpose —
 * because the URI portion still has to match.
 */
export function isCurrentActiveDocumentId(documentId: string | undefined): boolean {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return false;
  }
  return getDocumentId(activeTextEditor.document) === documentId;
}

/**
 * Extracts the document URI portion from a versioned document ID (strips `@version` suffix).
 */
export function extractDocumentIdFromVersioned(versionedDocumentId: string): string {
  const atIdx = versionedDocumentId.lastIndexOf("@");
  return atIdx >= 0 ? versionedDocumentId.substring(0, atIdx) : versionedDocumentId;
}

export function getCurrentActiveVersionedDocumentId(): string | undefined {
  const { activeTextEditor } = vscode.window;
  if (!activeTextEditor) {
    return undefined;
  }
  return getVersionedDocumentId(activeTextEditor.document);
}

export function getVersionedDocumentId(document: vscode.TextDocument): string {
  return `${getDocumentId(document)}@${document.version}`;
}

export function getDocumentId(document: vscode.TextDocument): string {
  return getDocumentIdFromUri(document.uri);
}

export function getDocumentIdFromUri(uri: vscode.Uri): string {
  return uri.toString();
}

/** Separator between a document id and a content id in a scoped tree-item id.
 * A NUL byte cannot appear in a URI or a display name, so the scoped id is
 * unambiguous and reversible. */
const TREE_ITEM_ID_SEPARATOR = "\u0000";

/**
 * Namespaces a content-based tree-item id (e.g. "region-Foo-1") to a specific
 * document. VS Code's per-view expansion memory is keyed on `TreeItem.id`
 * globally, so two files that both contain a same-named symbol/region would
 * otherwise share an expansion entry and cross-contaminate each other's
 * collapse state (plan D-5).
 */
export function scopeTreeItemIdToDocument(
  documentId: string | undefined,
  baseId: string
): string {
  return `${documentId ?? "no-document"}${TREE_ITEM_ID_SEPARATOR}${baseId}`;
}

/**
 * Rewrites a scoped tree-item id from one document to another, preserving the
 * base-id portion after the NUL separator. Used by the collapse-state
 * rename/move migration: the Full Outline view persists ids of the form
 * `<documentId>\0<baseId>`, so migrating a store's key to a new documentId must
 * also rescope its stored ids or every post-rename lookup misses.
 *
 * Ids that are NOT scoped to `oldDocumentId` (e.g. the Regions view's unscoped
 * Region model ids, which contain no NUL prefix for this document) pass through
 * unchanged, so this is safe to apply blindly to either view's stored ids. The
 * NUL convention lives entirely in this module.
 */
export function rescopeTreeItemId(
  oldDocumentId: string,
  newDocumentId: string,
  id: string
): string {
  const oldPrefix = `${oldDocumentId}${TREE_ITEM_ID_SEPARATOR}`;
  if (!id.startsWith(oldPrefix)) {
    return id;
  }
  return `${newDocumentId}${TREE_ITEM_ID_SEPARATOR}${id.slice(oldPrefix.length)}`;
}
