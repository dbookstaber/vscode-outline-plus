import * as assert from "assert";
import * as vscode from "vscode";
import {
    getRegionBoundaryPatternMap,
    refreshRegionBoundaryPatternMap,
    registerRegionBoundaryPatternConfigListener,
} from "../../lib/regionBoundaryPatterns";
import { delay, waitForCondition } from "../utils/waitForEvent";

/**
 * Tests for CODE_REVIEW_MAY #4 — `outlinePlus.regionBoundaryPatternByLanguageId`
 * edits must take effect without an extension reload.
 *
 * Pre-fix: the module-level pattern map was built once on import. Pattern edits
 * had no effect until the host reloaded.
 *
 * Post-fix: `refreshRegionBoundaryPatternMap()` invalidates the cache, and
 * `registerRegionBoundaryPatternConfigListener` wires it up to
 * `workspace.onDidChangeConfiguration` so the cache is rebuilt automatically.
 */
suite("regionBoundaryPatterns config listener (CODE_REVIEW_MAY #4)", function () {
  this.timeout(15000);

  const customLanguageId = "outline-plus-test-lang";
  const configKey = "outlinePlus.regionBoundaryPatternByLanguageId";

  // Capture the global configuration state so we can restore it between tests.
  // Use Workspace scope where possible to keep blast-radius small; this test
  // file does need Global since `outlinePlus.regionBoundaryPatternByLanguageId`
  // lives in user-scope by default and the test environment isolates per-run
  // via `.vscode-test/user-data` cleanup (see package.json scripts.test).
  let originalValue: unknown;

  suiteSetup(() => {
    const config = vscode.workspace.getConfiguration();
    originalValue = config.get(configKey);
  });

  suiteTeardown(async () => {
    const config = vscode.workspace.getConfiguration();
    await config.update(configKey, originalValue, vscode.ConfigurationTarget.Global);
    refreshRegionBoundaryPatternMap();
  });

  setup(() => {
    refreshRegionBoundaryPatternMap();
  });

  test("refreshRegionBoundaryPatternMap rebuilds from current configuration", async () => {
    const config = vscode.workspace.getConfiguration();
    const baseValue = (config.get<Record<string, unknown>>(configKey) ?? {});

    // Before adding our custom language, it should not be present.
    refreshRegionBoundaryPatternMap();
    const before = getRegionBoundaryPatternMap();
    assert.strictEqual(before[customLanguageId], undefined,
      "Sanity check — custom language should not exist before update");

    // Add a custom language pattern through the configuration system.
    const updated = {
      ...baseValue,
      [customLanguageId]: {
        startRegex: "^\\s*## REGION:(.*)$",
        endRegex: "^\\s*## ENDREGION\\s*$",
      },
    };
    await config.update(configKey, updated, vscode.ConfigurationTarget.Global);

    // Without the listener wired (we did not register one in this test),
    // explicitly refresh and verify the new pattern is picked up.
    refreshRegionBoundaryPatternMap();
    const after = getRegionBoundaryPatternMap();
    assert.ok(after[customLanguageId], "Custom language must appear after refresh");
  });

  test("registerRegionBoundaryPatternConfigListener fires onChange when the watched key changes", async () => {
    const subscriptions: vscode.Disposable[] = [];
    let fireCount = 0;
    registerRegionBoundaryPatternConfigListener(subscriptions, () => {
      fireCount += 1;
    });

    try {
      const config = vscode.workspace.getConfiguration();
      // First, clear any prior state so the next write is a definite change.
      await config.update(configKey, originalValue, vscode.ConfigurationTarget.Global);
      // Allow the prior-state event (if any) to drain so it doesn't count.
      await delay(150);
      fireCount = 0;

      const baseValue = (config.get<Record<string, unknown>>(configKey) ?? {});
      const updated = {
        ...baseValue,
        [customLanguageId]: {
          // Use a uniquely-named language so the value definitely differs.
          startRegex: "^\\s*## UNIQUE-REGION-MARKER:(.*)$",
          endRegex: "^\\s*## UNIQUE-ENDREGION-MARKER\\s*$",
        },
      };
      await config.update(configKey, updated, vscode.ConfigurationTarget.Global);

      await waitForCondition(() => fireCount >= 1, 4000);
      assert.ok(fireCount >= 1, "Listener should fire at least once after config change");

      // The cache should be refreshed; new language should be visible.
      const map = getRegionBoundaryPatternMap();
      assert.ok(map[customLanguageId], "Custom language must be present after listener-triggered refresh");
    } finally {
      for (const d of subscriptions) d.dispose();
    }
  });

  test("listener ignores unrelated configuration changes", async () => {
    const subscriptions: vscode.Disposable[] = [];
    let fireCount = 0;
    registerRegionBoundaryPatternConfigListener(subscriptions, () => {
      fireCount += 1;
    });

    try {
      // Change an unrelated outlinePlus setting.
      const config = vscode.workspace.getConfiguration();
      const originalDebug = config.get<boolean>("outlinePlus.enableDebugLogging");
      await config.update(
        "outlinePlus.enableDebugLogging",
        !(originalDebug ?? false),
        vscode.ConfigurationTarget.Global
      );

      // Give the event system a moment to dispatch.
      await delay(300);

      // Restore.
      await config.update(
        "outlinePlus.enableDebugLogging",
        originalDebug,
        vscode.ConfigurationTarget.Global
      );

      assert.strictEqual(fireCount, 0,
        "Listener should not fire for outlinePlus.enableDebugLogging changes");
    } finally {
      for (const d of subscriptions) d.dispose();
    }
  });
});
