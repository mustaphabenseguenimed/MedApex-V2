import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { canonicalizeCaseStems, caseKey } from "./importQuestions";

const q = (case_stem: string | null, stem = "x") => ({ case_stem, stem });
/** How many distinct cas_clinique parents the insert would create. */
const caseCount = (items: { case_stem?: string | null }[]) =>
  new Set(items.map(caseKey).filter(Boolean)).size;

const VIGNETTE =
  "Un patient de 24 ans, sans antécédents, consulte aux urgences pour une douleur thoracique brutale droite avec dyspnée.";

describe("canonicalizeCaseStems", () => {
  // The reported symptom: the conversion tool showed one clinical case, the
  // import created several, and the sub-questions ended up split between them.
  test("a vignette re-typed further down still imports as ONE case", () => {
    const items = [q(VIGNETTE), q(VIGNETTE.replace("dyspnée", "dyspnee")), q(VIGNETTE)];
    assert.equal(caseCount(items), 2, "unfixed, this is what split the case");
    assert.equal(caseCount(canonicalizeCaseStems(items)), 1);
  });

  test("every member ends up with the first member's énoncé", () => {
    const out = canonicalizeCaseStems([q(VIGNETTE), q(`${VIGNETTE} La radiographie est faite.`)]);
    assert.equal(out[1].case_stem, VIGNETTE);
  });

  test("two genuinely different cases stay two cases", () => {
    const other = "Une femme de 60 ans, diabétique, présente une plaie du pied évoluant depuis…";
    const out = canonicalizeCaseStems([q(VIGNETTE), q(other), q(VIGNETTE)]);
    assert.equal(caseCount(out), 2);
    assert.equal(out[1].case_stem, other);
  });

  test("questions with no case are left exactly as they were", () => {
    const items = [q(null), q(""), q(VIGNETTE)];
    const out = canonicalizeCaseStems(items);
    assert.equal(out[0], items[0], "untouched, same object");
    assert.equal(out[1], items[1]);
    assert.equal(caseCount(out), 1);
  });

  test("markup differences alone do not split a case", () => {
    const out = canonicalizeCaseStems([q(`<p>${VIGNETTE}</p>`), q(`<div>${VIGNETTE}</div>`)]);
    assert.equal(caseCount(out), 1);
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(canonicalizeCaseStems([]), []);
  });
});
