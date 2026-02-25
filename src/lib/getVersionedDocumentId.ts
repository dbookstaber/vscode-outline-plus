import * as vscode from "vscode";

export function isCurrentActiveVersionedDocumentId(
  versionedDocumentId: string | undefined
): boolean {
  const currentActiveDocumentId = getCurrentActiveVersionedDocumentId();
  return currentActiveDocumentId === versionedDocumentId;
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
