import * as assert from "assert";
import * as vscode from "vscode";
import { refreshRegionBoundaryPatternMap } from "../../lib/regionBoundaryPatterns";
import { delay } from "../utils/waitForEvent";

/**
 * Regression test for Plan 2.V3 — an invalid user/workspace region regex
 * silently disabled that language, with the only trace in a Debug Log output
 * channel the user never opens. The fix shows a one-time warning naming the
 * language (for NON-DEFAULT patterns only).
 */
suite("Plan 2.V3 — invalid non-default pattern surfaces a warning", function () {
  this.timeout(10000);

  const configKey = "outlinePlus.regionBoundaryPatternByLanguageId";
  const customLanguageId = "outline-plus-invalid-regex-lang";

  test("compiling an invalid custom pattern shows a warning naming the language", async () => {
    const config = vscode.workspace.getConfiguration();
    const baseValue = config.get<Record<string, unknown>>(configKey) ?? {};

    type ShowWarning = typeof vscode.window.showWarningMessage;
    const mutableWindow = vscode.window as { showWarningMessage: ShowWarning };
    const originalShowWarning = mutableWindow.showWarningMessage;
    let warningCount = 0;
    let lastMessage = "";
    const stub = ((message: string): Thenable<undefined> => {
      warningCount += 1;
      lastMessage = message;
      return Promise.resolve(undefined);
    }) as unknown as ShowWarning;
    mutableWindow.showWarningMessage = stub;

    try {
      await config.update(
        configKey,
        {
          ...baseValue,
          [customLanguageId]: {
            // Unbalanced group → `new RegExp("(")` throws.
            startRegex: "(",
            endRegex: "^\\s*#endregion$",
          },
        },
        vscode.ConfigurationTarget.Global
      );

      refreshRegionBoundaryPatternMap();
      // The extension's own config listener may also refresh; give it a moment.
      await delay(150);

      assert.ok(
        warningCount >= 1,
        "An invalid non-default pattern must surface a warning message"
      );
      assert.ok(
        lastMessage.includes(customLanguageId),
        `Warning should name the offending language (was: "${lastMessage}")`
      );
    } finally {
      mutableWindow.showWarningMessage = originalShowWarning;
      await config.update(configKey, baseValue, vscode.ConfigurationTarget.Global);
      refreshRegionBoundaryPatternMap();
    }
  });
});
