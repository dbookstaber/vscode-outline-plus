import * as assert from "assert";
import * as vscode from "vscode";

/**
 * Regression test for Plan 2.7 — `when` keys placed directly on
 * `contributes.commands` entries are not part of the manifest schema and are
 * silently ignored, so BOTH the Start and Stop auto-highlight toggle variants
 * always showed in the Command Palette. The conditions must live in
 * `contributes.menus.commandPalette` instead.
 */
suite("Plan 2.7 — command-palette visibility conditions", () => {
  type CommandContribution = { command: string; title: string; when?: string };
  type MenuEntry = { command: string; when?: string };

  function getManifest(): {
    contributes: {
      commands: CommandContribution[];
      menus: Record<string, MenuEntry[] | undefined>;
    };
  } {
    const extension = vscode.extensions.getExtension("DavidBookstaber.outline-regions-plus");
    assert.ok(extension, "Outline++ extension must be installed in the test host");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return extension.packageJSON;
  }

  const toggleCommandIds = [
    "outlinePlus.regionsView.stopAutoHighlightingActiveRegion",
    "outlinePlus.regionsView.startAutoHighlightingActiveRegion",
    "outlinePlus.fullOutlineView.stopAutoHighlightingActiveItem",
    "outlinePlus.fullOutlineView.startAutoHighlightingActiveItem",
  ];

  test("no command declares a `when` key (ignored by the schema)", () => {
    const { commands } = getManifest().contributes;
    const commandsWithWhen = commands.filter((c) => c.when !== undefined);
    assert.deepStrictEqual(
      commandsWithWhen.map((c) => c.command),
      [],
      "`when` on contributes.commands is silently ignored — move it to menus.commandPalette"
    );
  });

  test("commandPalette gates every auto-highlight toggle variant", () => {
    const palette = getManifest().contributes.menus["commandPalette"] ?? [];
    for (const commandId of toggleCommandIds) {
      const entry = palette.find((e) => e.command === commandId);
      assert.ok(entry, `commandPalette must contain an entry for ${commandId}`);
      assert.ok(
        entry.when?.includes("config.outlinePlus") === true,
        `commandPalette entry for ${commandId} must carry a config-based when clause`
      );
    }
  });
});
