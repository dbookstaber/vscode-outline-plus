import * as assert from "assert";
import * as vscode from "vscode";
import {
    getGlobalFullOutlineViewConfigValue,
    setGlobalFullOutlineViewConfigValue,
} from "../../config/config";
import { delay } from "../utils/waitForEvent";

/**
 * Regression test for Plan 2.V2 — the view-title toggles always wrote
 * `ConfigurationTarget.Global`. When a Workspace override shadows the setting,
 * a Global write is a silent no-op: the workspace value keeps winning, so the
 * toggle appears to do nothing.
 *
 * The fix writes to the scope that currently supplies the effective value.
 */
suite("Plan 2.V2 — config writes target the effective scope", function () {
  this.timeout(10000);

  const key = "outlinePlus.fullOutlineView.shouldAutoHighlightActiveItem";

  async function clearAllScopes(): Promise<void> {
    const config = vscode.workspace.getConfiguration();
    await config.update(key, undefined, vscode.ConfigurationTarget.Workspace);
    await config.update(key, undefined, vscode.ConfigurationTarget.Global);
  }

  suiteSetup(function () {
    const folders = vscode.workspace.workspaceFolders;
    if (folders === undefined || folders.length === 0) {
      // Workspace-scoped writes require an open folder; the test harness opens
      // one, but guard so this doesn't hard-fail in other environments.
      this.skip();
    }
  });

  teardown(async () => {
    await clearAllScopes();
  });

  test("toggle takes effect even when a workspace override shadows the value", async () => {
    const config = vscode.workspace.getConfiguration();

    // A workspace override pins the effective value to false, and a Global value
    // disagrees. A naive Global-only write cannot change the effective value.
    await config.update(key, false, vscode.ConfigurationTarget.Workspace);
    await config.update(key, true, vscode.ConfigurationTarget.Global);
    await delay(100);
    assert.strictEqual(
      getGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem"),
      false,
      "Sanity: workspace override should shadow the global value"
    );

    // Toggle it "on" through the same code path the view-title command uses.
    await setGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem", true);
    await delay(100);

    assert.strictEqual(
      getGlobalFullOutlineViewConfigValue("shouldAutoHighlightActiveItem"),
      true,
      "Toggle must update the effective (workspace) scope, not silently no-op on Global"
    );
  });
});
