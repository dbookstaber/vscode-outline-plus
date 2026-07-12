import * as vscode from "vscode";
import { EXTENSION_DISPLAY_NAME } from "../constants";

/**
 * Command feedback for region navigation/selection no-ops (plan 6.7).
 *
 * When a region command does nothing — no editor, no regions in the file, the
 * cursor is outside every region, or there is no region in the requested
 * direction — the silence is indistinguishable from "the extension is broken".
 * These commands surface a transient status-bar message naming *why* nothing
 * happened so the user gets deterministic feedback.
 */
export type RegionCommandNoOpReason =
  | "noEditor"
  | "noRegions"
  | "cursorOutsideRegion"
  | "noNextRegion"
  | "noPreviousRegion";

/** How long the transient status-bar message stays up. */
export const NO_OP_STATUS_MESSAGE_TIMEOUT_MS = 4000;

/**
 * Maps a no-op reason to its user-facing message. Pure (no VS Code calls) so it
 * can be unit-tested directly.
 */
export function getRegionCommandNoOpMessage(reason: RegionCommandNoOpReason): string {
  switch (reason) {
    case "noEditor":
      return `${EXTENSION_DISPLAY_NAME}: No active editor.`;
    case "noRegions":
      return `${EXTENSION_DISPLAY_NAME}: No regions in this file.`;
    case "cursorOutsideRegion":
      return `${EXTENSION_DISPLAY_NAME}: Cursor is not inside a region.`;
    case "noNextRegion":
      return `${EXTENSION_DISPLAY_NAME}: No region below the cursor.`;
    case "noPreviousRegion":
      return `${EXTENSION_DISPLAY_NAME}: No region above the cursor.`;
  }
}

/**
 * Shows the transient status-bar message for a region command no-op. Thin
 * wrapper over {@link vscode.window.setStatusBarMessage} (auto-hides after the
 * timeout); the message text is produced by the pure
 * {@link getRegionCommandNoOpMessage}.
 */
export function showRegionCommandNoOp(reason: RegionCommandNoOpReason): void {
  vscode.window.setStatusBarMessage(
    getRegionCommandNoOpMessage(reason),
    NO_OP_STATUS_MESSAGE_TIMEOUT_MS
  );
}
