import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { normalizeInlineTextColors } from "./htmlColors";

const VRAI = "#16a34a";
const FAUX = "#dc2626";

describe("a per-proposition explanation takes its verdict's colour", () => {
  const colorOf = (html: string, label: string) =>
    html.match(new RegExp(`color:(#[0-9a-f]{6})[^>]*">${label}`, "i"))?.[1] ?? null;

  test("the option letter is coloured like its own line", () => {
    const out = normalizeInlineTextColors(
      "<ul><li><strong>A.</strong> Faux. Les lésions prédominent aux bases.</li>" +
        "<li><strong>B.</strong> Vrai. L'association est caractéristique.</li></ul>",
    );
    assert.equal(colorOf(out, "A\\."), FAUX);
    assert.equal(colorOf(out, "B\\."), VRAI);
  });

  // An association question numbers its propositions, and the LETTER rule
  // never saw a digit — so the number stayed black beside a red "Faux".
  test("so is the proposition number of an association question", () => {
    const out = normalizeInlineTextColors(
      "<ul><li><strong>1.</strong> Faux. Les lésions prédominent aux bases.</li>" +
        "<li><strong>2.</strong> Vrai. L'association est caractéristique.</li></ul>",
    );
    assert.equal(colorOf(out, "1\\."), FAUX);
    assert.equal(colorOf(out, "2\\."), VRAI);
  });

  test("the verdict word itself keeps its own colour", () => {
    const out = normalizeInlineTextColors("<p>1. Faux. Une justification.</p>");
    assert.match(out, new RegExp(`color:${FAUX}[^>]*">Faux</span>`));
  });

  // Only the label at the head of the line, never a figure in the prose: a
  // justification quoting "2 cm" must not turn its 2 red.
  test("a figure inside the justification is left alone", () => {
    const out = normalizeInlineTextColors("<p>A. Faux. Un nodule de 2 - 3 cm reste visible.</p>");
    assert.equal((out.match(new RegExp(`color:${FAUX};font-weight:700`, "g")) ?? []).length, 1);
    assert.ok(out.includes("2 - 3 cm"), "the prose is untouched");
  });

  test("a line with no verdict colours nothing", () => {
    const out = normalizeInlineTextColors("<p>1. Une remarque sans verdict.</p>");
    assert.ok(!out.includes("font-weight:700"), "no label colour without a verdict");
  });
});
