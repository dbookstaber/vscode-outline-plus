import {
    setGlobalFullOutlineViewConfigValue,
    setGlobalRegionsViewConfigValue,
} from "../config/config";

/**
 * The Start/Stop auto-highlight toggles for both tree views, unified onto one
 * parameterized writer (plan 3.11 — previously the Full Outline pair
 * check-and-messaged while the Regions pair wrote blind).
 *
 * Chosen behavior: write the setting unconditionally, with no "already in that
 * state" message. Both invocation surfaces (view/title and command palette) gate
 * each command's visibility on the setting's current value
 * (`config.outlinePlus.<view>.shouldAutoHighlight*` when-clauses), so a toggle is
 * only ever surfaced when it will actually flip the value — the old
 * already-in-state branch was unreachable in real use, so its info message was
 * dead UX. The effective-scope write (plan 2.V2) lives in the config setters.
 */
function setAutoHighlight(view: "fullOutline" | "regions", enabled: boolean): void {
  if (view === "fullOutline") {
    void setGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem", enabled);
  } else {
    void setGlobalRegionsViewConfigValue("shouldAutoHighlightActiveRegion", enabled);
  }
}

export function startAutoHighlightingActiveItem(): void {
  setAutoHighlight("fullOutline", true);
}

export function stopAutoHighlightingActiveItem(): void {
  setAutoHighlight("fullOutline", false);
}

export function startAutoHighlightingActiveRegion(): void {
  setAutoHighlight("regions", true);
}

export function stopAutoHighlightingActiveRegion(): void {
  setAutoHighlight("regions", false);
}
