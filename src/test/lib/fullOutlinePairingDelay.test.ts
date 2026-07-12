import * as assert from "assert";
import { DEBOUNCE_DOCUMENT_PARSE_MS, DEBOUNCE_FULL_OUTLINE_PAIRING_MS } from "../../constants";

/**
 * Guard for plan 4.3: FullOutlineStore's refresh window is a short *pairing*
 * delay, not a second full parse debounce stacked on top of the upstream stores.
 *
 * FullOutlineStore's inputs (region + symbol data) already arrive debounced by
 * DEBOUNCE_DOCUMENT_PARSE_MS. Using the full parse debounce again here added
 * ~250 ms of pure serial latency to every keystroke→tree update. This test
 * fails (or does not compile) if the pairing delay is ever restored to the full
 * parse-debounce value.
 *
 * The behavioural re-validation of the highlight race fixes (FUTURE_WORK
 * suspects A–D) at the shortened timing lives in the existing highlight/editing
 * suites (autoHighlightRevealGate, fullOutlineDocumentEditing,
 * fullOutlineActiveEditorSwitch, eventFiringPrecision), which are run at the new
 * constant.
 */
suite("FullOutlineStore pairing debounce (plan 4.3)", () => {
  test("pairing delay is the short 50ms coalescing window", () => {
    assert.strictEqual(
      DEBOUNCE_FULL_OUTLINE_PAIRING_MS,
      50,
      "FullOutlineStore's pairing delay should be a short coalescing window (50ms)"
    );
  });

  test("pairing delay is strictly shorter than the upstream parse debounce", () => {
    // Cast to `number` so the assertion compares values, not the literal
    // constant types (which eslint's type-aware check would flag as constant).
    assert.ok(
      (DEBOUNCE_FULL_OUTLINE_PAIRING_MS as number) < (DEBOUNCE_DOCUMENT_PARSE_MS as number),
      `pairing delay (${DEBOUNCE_FULL_OUTLINE_PAIRING_MS}ms) must be shorter than the parse ` +
        `debounce (${DEBOUNCE_DOCUMENT_PARSE_MS}ms) — otherwise it re-stacks a full debounce ` +
        `onto keystroke→tree latency`
    );
  });
});
