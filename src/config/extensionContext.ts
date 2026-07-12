/**
 * Global extension context storage.
 * Stores extension-level context that needs to be accessed from various modules.
 */

import type * as vscode from "vscode";

let _extensionUri: vscode.Uri | undefined;

/**
 * Initialize extension context with the extension root URI.
 * Call this from extension.activate().
 *
 * We store the {@link vscode.Uri} (not the string `extensionPath`) so asset URIs
 * are built with scheme-preserving {@link vscode.Uri.joinPath}. On the web
 * (vscode.dev) the extension root is a non-`file:` URI, and coercing it through
 * `vscode.Uri.file(extensionPath)` would produce a broken `file://` asset URI.
 */
export function initializeExtensionContext(extensionUri: vscode.Uri): void {
  _extensionUri = extensionUri;
}

/**
 * Get the extension root URI.
 * @returns The extension URI, or undefined if not yet initialized.
 */
export function getExtensionUri(): vscode.Uri | undefined {
  return _extensionUri;
}
