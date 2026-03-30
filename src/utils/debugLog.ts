import * as vscode from "vscode";

/**
 * Centralized debug logging for Outline++.
 *
 * Writes timestamped entries to an Output Channel ("Outline++") that users
 * can open via the Command Palette > "Outline++: Show Debug Log" or
 * from the Output panel dropdown.
 *
 * Logging is opt-in: controlled by the `outlinePlus.enableDebugLogging` setting.
 * When disabled, calls to `log()` are no-ops to avoid performance overhead.
 */

let _outputChannel: vscode.OutputChannel | undefined;
let _isEnabled = false;

export function initializeDebugLog(subscriptions: vscode.Disposable[]): void {
  _outputChannel = vscode.window.createOutputChannel("Outline++");
  subscriptions.push(_outputChannel);

  // Read initial setting
  _isEnabled = vscode.workspace
    .getConfiguration("outlinePlus")
    .get<boolean>("enableDebugLogging", false);

  // React to setting changes
  vscode.workspace.onDidChangeConfiguration(
    (e) => {
      if (e.affectsConfiguration("outlinePlus.enableDebugLogging")) {
        _isEnabled = vscode.workspace
          .getConfiguration("outlinePlus")
          .get<boolean>("enableDebugLogging", false);
        if (_isEnabled) {
          log("Debug logging enabled");
        }
      }
    },
    undefined,
    subscriptions
  );
}

export function log(message: string): void {
  if (!_isEnabled || !_outputChannel) {
    return;
  }
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  _outputChannel.appendLine(`[${timestamp}] ${message}`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint"
  ) {
    return String(error);
  }
  if (error === null) {
    return "null";
  }
  if (error === undefined) {
    return "undefined";
  }
  try {
    return JSON.stringify(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}

export function logError(message: string, error?: unknown): void {
  if (!_outputChannel) {
    return;
  }
  const timestamp = new Date().toISOString().slice(11, 23); // HH:mm:ss.SSS
  _outputChannel.appendLine(`[${timestamp}] ERROR: ${message}`);
  if (error !== undefined) {
    _outputChannel.appendLine(formatError(error));
  }
}

export function showDebugLog(): void {
  if (!_outputChannel) {
    return;
  }
  _outputChannel.show(true);
}

/**
 * Dumps the current state of all stores to the output channel for debugging.
 */
export function dumpDiagnosticState(context: {
  regionStoreVersionedDocId: string | undefined;
  documentSymbolStoreVersionedDocId: string | undefined;
  fullOutlineStoreVersionedDocId: string | undefined;
  fullOutlineStoreDocId: string | undefined;
  activeEditorUri: string | undefined;
  activeEditorVersion: number | undefined;
  regionCount: number;
  symbolCount: number;
  fullOutlineItemCount: number;
}): void {
  if (!_outputChannel) {
    return;
  }
  const wasEnabled = _isEnabled;
  // Always dump diagnostics, even if logging is normally off
  _isEnabled = true;
  log("=== DIAGNOSTIC STATE DUMP ===");
  log(`Active editor URI: ${context.activeEditorUri ?? "(none)"}`);
  log(`Active editor version: ${context.activeEditorVersion ?? "(none)"}`);
  log(`RegionStore versionedDocId: ${context.regionStoreVersionedDocId ?? "(none)"}`);
  log(`DocumentSymbolStore versionedDocId: ${context.documentSymbolStoreVersionedDocId ?? "(none)"}`);
  log(`FullOutlineStore versionedDocId: ${context.fullOutlineStoreVersionedDocId ?? "(none)"}`);
  log(`FullOutlineStore documentId: ${context.fullOutlineStoreDocId ?? "(none)"}`);
  log(`Region count: ${context.regionCount}`);
  log(`Symbol count: ${context.symbolCount}`);
  log(`Full outline top-level item count: ${context.fullOutlineItemCount}`);
  log("=== END DIAGNOSTIC STATE DUMP ===");
  _isEnabled = wasEnabled;
  _outputChannel.show(true);
}
