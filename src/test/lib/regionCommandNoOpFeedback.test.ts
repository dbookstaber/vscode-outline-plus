import * as assert from "assert";
import * as vscode from "vscode";
import {
    CMD_GO_TO_NEXT_REGION,
    CMD_GO_TO_PREVIOUS_REGION,
    CMD_GO_TO_REGION_BOUNDARY,
    CMD_SELECT_CURRENT_REGION,
} from "../../constants";
import {
    type RegionCommandNoOpReason,
    getRegionCommandNoOpMessage,
} from "../../commands/regionCommandFeedback";
import { waitForCondition } from "../utils/waitForEvent";

/**
 * Plan 6.7 — region command no-op feedback.
 *
 * Two layers:
 *  1. The pure `getRegionCommandNoOpMessage` mapping (no VS Code calls).
 *  2. The registered commands executed against a *no-region* document: they must
 *     not throw and must not move the cursor (the observable no-op behavior). The
 *     transient status-bar message itself is not observable via the API, so it is
 *     covered by the pure-helper test instead.
 */
suite("Region command no-op feedback (plan 6.7)", function () {
  this.timeout(15000);

  suite("getRegionCommandNoOpMessage (pure)", () => {
    const reasons: RegionCommandNoOpReason[] = [
      "noEditor",
      "noRegions",
      "cursorOutsideRegion",
      "noNextRegion",
      "noPreviousRegion",
    ];

    test("every reason maps to a distinct, non-empty, extension-prefixed message", () => {
      const messages = reasons.map(getRegionCommandNoOpMessage);
      for (const message of messages) {
        assert.ok(message.length > 0, "message must be non-empty");
        assert.ok(message.startsWith("Outline++:"), "message names the extension");
      }
      assert.strictEqual(new Set(messages).size, reasons.length, "each reason is distinct");
    });

    test("messages name why nothing happened", () => {
      assert.match(getRegionCommandNoOpMessage("noEditor"), /no active editor/i);
      assert.match(getRegionCommandNoOpMessage("noRegions"), /no regions/i);
      assert.match(getRegionCommandNoOpMessage("cursorOutsideRegion"), /not inside a region/i);
      assert.match(getRegionCommandNoOpMessage("noNextRegion"), /below/i);
      assert.match(getRegionCommandNoOpMessage("noPreviousRegion"), /above/i);
    });
  });

  suite("commands are safe no-ops in a document with no regions", () => {
    suiteSetup(async () => {
      const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
      assert.ok(extension, "Outline++ extension must be present");
      await extension.activate();
    });

    teardown(async () => {
      await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    });

    const noOpCommands = [
      CMD_GO_TO_NEXT_REGION,
      CMD_GO_TO_PREVIOUS_REGION,
      CMD_GO_TO_REGION_BOUNDARY,
      CMD_SELECT_CURRENT_REGION,
    ];

    for (const command of noOpCommands) {
      test(`${command} does not throw and leaves the cursor put`, async () => {
        const doc = await vscode.workspace.openTextDocument({
          content: "const x = 1;\nconst y = 2;\n",
          language: "typescript",
        });
        const editor = await vscode.window.showTextDocument(doc);
        editor.selection = new vscode.Selection(1, 0, 1, 0);
        // Let the live RegionStore settle on zero regions for this document.
        await waitForCondition(
          () => vscode.window.activeTextEditor?.document === doc,
          3000,
          25
        );

        // Must not reject (the command handler must not throw on any no-op path).
        await vscode.commands.executeCommand(command);

        // The cursor-moving/selecting commands must leave the selection where it was.
        assert.strictEqual(editor.selection.active.line, 1, "cursor line unchanged");
        assert.strictEqual(editor.selection.active.character, 0, "cursor character unchanged");
      });
    }
  });
});
