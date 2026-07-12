import { type TextDocument } from "vscode";

/**
 * Document URI schemes that Outline++ should never treat as an editable source
 * document (plan 4.7b). These are surfaced to the extension as `activeTextEditor`
 * documents when their panel gains focus, but they will never have a region
 * structure worth parsing nor a symbol provider that resolves:
 *
 * - `output`: the Output panel's read-only channels. Focusing the panel used to
 *   (a) run `parseAllRegions` over the channel text on every focus change, and
 *   (b) launch DocumentSymbolStore's full ~20 s / 10-attempt retry ladder against
 *   a document that can never gain a provider — pure churn, with stale chains
 *   dying on the generation check.
 *
 * Kept deliberately as a *deny*-list rather than an allow-list: the trees and
 * diagnostics are otherwise scheme-agnostic on purpose (plan 4.5 counterpoint),
 * so virtual-workspace schemes (`vscode-vfs:`, `vsls:`) and the like must keep
 * working. We only exclude schemes known to be non-source panels.
 */
const IGNORED_DOCUMENT_SCHEMES: ReadonlySet<string> = new Set(["output"]);

/**
 * Returns true when the document belongs to a scheme Outline++ should ignore
 * (see {@link IGNORED_DOCUMENT_SCHEMES}). Callers retain their last-known state
 * instead of clearing/parsing/fetching for such documents.
 */
export function isIgnoredDocumentScheme(document: TextDocument): boolean {
  return IGNORED_DOCUMENT_SCHEMES.has(document.uri.scheme);
}
