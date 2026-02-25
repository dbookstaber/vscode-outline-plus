/**
 * Global extension context storage.
 * Stores extension-level context that needs to be accessed from various modules.
 */

let _extensionPath: string | undefined;

/**
 * Initialize extension context with the extension path.
 * Call this from extension.activate().
 */
export function initializeExtensionContext(extensionPath: string): void {
  _extensionPath = extensionPath;
}

/**
 * Get the extension installation path.
 * @returns The extension path, or undefined if not yet initialized.
 */
export function getExtensionPath(): string | undefined {
  return _extensionPath;
}
