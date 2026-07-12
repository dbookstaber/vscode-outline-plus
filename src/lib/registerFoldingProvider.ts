import * as vscode from "vscode";
import { type RegionFoldingProvider } from "./RegionFoldingProvider";
import { getConfiguredRegionLanguageIds } from "./regionBoundaryPatterns";

/**
 * Builds the folding-range provider's document selector: one language-scoped
 * filter per configured language, with **no scheme clause**.
 *
 * Deliberately scheme-agnostic. The region trees and diagnostics are scheme
 * agnostic, so folding must be too: a `{ scheme: "file" }` selector silently
 * excludes virtual workspaces (`vscode-vfs:`, `vsls:`) and untitled buffers,
 * while a bare `{ scheme: "file" }` (the pre-4.5 registration) *over*-includes —
 * routing every file-scheme document (diffs, background editors, .txt/.log)
 * through a from-scratch synchronous parse. Scoping by language id instead means
 * unconfigured languages are never consulted, while every scheme that hosts a
 * configured language keeps working (plan 4.5).
 */
export function buildFoldingDocumentSelector(
  languageIds: readonly string[]
): vscode.DocumentFilter[] {
  return languageIds.map((language) => ({ language }));
}

/**
 * Registers {@link RegionFoldingProvider} for the currently configured region
 * languages. Returns the registration disposable so the caller can dispose and
 * re-register when the region-pattern configuration changes (a newly configured
 * language must start receiving folding; a removed one must stop).
 */
export function registerFoldingProviderForConfiguredLanguages(
  provider: RegionFoldingProvider
): vscode.Disposable {
  const selector = buildFoldingDocumentSelector(getConfiguredRegionLanguageIds());
  return vscode.languages.registerFoldingRangeProvider(selector, provider);
}
