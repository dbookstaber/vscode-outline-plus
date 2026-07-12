import * as assert from "assert";
import {
  buildFoldingDocumentSelector,
} from "../../lib/registerFoldingProvider";
import {
  getConfiguredRegionLanguageIds,
  refreshRegionBoundaryPatternMap,
} from "../../lib/regionBoundaryPatterns";
import { getOutlinePlusConfig } from "../../config/config";
import * as vscode from "vscode";

/**
 * Tests for plan 4.5: the folding-range provider is scoped to the configured
 * region languages (scheme-agnostic), not a bare `{scheme:"file"}`, and the set
 * re-derives when the region-pattern configuration changes.
 */
suite("Folding provider selector scoping (plan 4.5)", function () {
  this.timeout(20000);

  const CONFIG_KEY = "regionBoundaryPatternByLanguageId";

  teardown(async () => {
    // Restore config to its default (undefined = fall back to packaged default)
    // and rebuild the cached map so later suites see the shipped defaults.
    await getOutlinePlusConfig().update(
      CONFIG_KEY,
      undefined,
      vscode.ConfigurationTarget.Global
    );
    refreshRegionBoundaryPatternMap();
  });

  test("configured language ids include shipped languages and exclude unconfigured ones", () => {
    refreshRegionBoundaryPatternMap();
    const languageIds = getConfiguredRegionLanguageIds();

    // A representative sample of shipped defaults must be present…
    for (const expected of ["typescript", "csharp", "python", "java"]) {
      assert.ok(
        languageIds.includes(expected),
        `Expected configured languages to include "${expected}"`
      );
    }
    // …and languages with no region pattern must be absent, so the folding
    // provider is never consulted (never parses) for them.
    for (const unconfigured of ["plaintext", "log", "search-result"]) {
      assert.ok(
        !languageIds.includes(unconfigured),
        `Expected configured languages NOT to include "${unconfigured}"`
      );
    }
  });

  test("document selector is language-scoped with NO scheme clause", () => {
    const selector = buildFoldingDocumentSelector(["typescript", "csharp"]);

    assert.strictEqual(selector.length, 2);
    for (const filter of selector) {
      assert.ok(typeof filter.language === "string" && filter.language.length > 0);
      assert.strictEqual(
        filter.scheme,
        undefined,
        "Folding selector must omit the scheme clause so virtual workspaces (vscode-vfs:/vsls:) keep working"
      );
      assert.strictEqual(filter.pattern, undefined);
    }
    assert.deepStrictEqual(
      selector.map((f) => f.language).sort(),
      ["csharp", "typescript"]
    );
  });

  test("empty configured-language set yields an empty selector", () => {
    assert.deepStrictEqual(buildFoldingDocumentSelector([]), []);
  });

  test("a newly configured language appears in the language set after config change (re-registration input)", async () => {
    // Pick a language id that is NOT in the shipped defaults so we can prove the
    // set grows in response to configuration — this is exactly the input the
    // extension uses to decide whether to re-register the folding provider.
    const novelLanguageId = "outlineplus-fake-lang";

    refreshRegionBoundaryPatternMap();
    assert.ok(
      !getConfiguredRegionLanguageIds().includes(novelLanguageId),
      "Precondition: the novel language must not already be configured"
    );

    await getOutlinePlusConfig().update(
      CONFIG_KEY,
      {
        [novelLanguageId]: {
          startRegex: "^\\s*#region\\b(.*)$",
          endRegex: "^\\s*#endregion\\b.*$",
        },
      },
      vscode.ConfigurationTarget.Global
    );
    // Simulate what registerRegionBoundaryPatternConfigListener does before
    // invoking its onChange callback (which re-registers the provider).
    refreshRegionBoundaryPatternMap();

    const afterChange = getConfiguredRegionLanguageIds();
    assert.ok(
      afterChange.includes(novelLanguageId),
      "After configuring a new language, it must appear in the folding selector's language set"
    );
    // The selector built from the new set must include the novel language.
    const selector = buildFoldingDocumentSelector(afterChange);
    assert.ok(
      selector.some((f) => f.language === novelLanguageId),
      "Re-derived selector must contain the newly configured language"
    );
  });
});
