import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { explanationLines, splitPerOptionExplanation } from "./explanationFormat";

const items = (html: string) => html.split("<hr />");
const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("explanationLines", () => {
  test("splits on soft breaks, which is how the .docx round trip arrives", () => {
    assert.deepEqual(explanationLines("1. un<br />2. deux<br/>3. trois"), [
      "1. un",
      "2. deux",
      "3. trois",
    ]);
  });

  test("splits on block and list boundaries", () => {
    assert.deepEqual(explanationLines("<ul><li>un</li><li>deux</li></ul>"), ["un", "deux"]);
    assert.deepEqual(explanationLines("<p>un</p><p>deux</p>"), ["un", "deux"]);
  });

  test("keeps inline markup inside a line", () => {
    assert.deepEqual(explanationLines("<strong>1.</strong> un<br /><strong>2.</strong> deux"), [
      "<strong>1.</strong> un",
      "<strong>2.</strong> deux",
    ]);
  });

  test("drops lines with no content, markup-only ones included", () => {
    assert.deepEqual(explanationLines("un<br /><br /><strong> </strong><br />deux"), [
      "un",
      "deux",
    ]);
  });
});

describe("splitPerOptionExplanation", () => {
  // The bug this module was extracted for: Step 2 numbers its explanations
  // 1-5, so the letters-only splitter left the whole thing in one paragraph.
  test("splits a flattened numbered explanation", () => {
    const out = splitPerOptionExplanation(
      "<p>1. Vrai, le pneumothorax. 2. Faux, l'emphysème. 3. Vrai, la pleurotomie.</p>",
    );
    assert.equal(items(out).length, 3);
    assert.match(items(out)[1], /<strong>2\.<\/strong>/);
    assert.equal(plain(items(out)[2]), "3. Vrai, la pleurotomie.");
  });

  test("still splits the lettered form it always handled", () => {
    const out = splitPerOptionExplanation("<p>A. Vrai. B) Faux. C - Vrai.</p>");
    assert.equal(items(out).length, 3);
    assert.match(items(out)[0], /<strong>A\.<\/strong>/);
  });

  test("keeps splitting a lettered run that does not start at A", () => {
    // Long-standing behaviour: only the justified propositions are listed.
    assert.equal(items(splitPerOptionExplanation("<p>B. Faux. C. Vrai.</p>")).length, 2);
  });

  test("leaves prose containing a stray number alone", () => {
    const prose = "<p>Le drainage s'impose 2. fois sur trois dans cette situation.</p>";
    assert.equal(splitPerOptionExplanation(prose), prose);
  });

  test("a numbered run that skips a proposition is not a list", () => {
    // 1 then 3: more likely prose than a ventilated explanation.
    const prose = "<p>1. Vrai. 3. Faux.</p>";
    assert.equal(splitPerOptionExplanation(prose), prose);
  });

  test("never mixes a letter marker with a number marker", () => {
    const prose = "<p>1. Vrai. B. Faux.</p>";
    assert.equal(splitPerOptionExplanation(prose), prose);
  });

  test("uses the line breaks when the paragraph already has them", () => {
    const out = splitPerOptionExplanation(
      "<p>1. Vrai, dans 2. cas sur 3.<br />2. Faux.<br />3. Vrai.</p>",
    );
    assert.equal(items(out).length, 3, "one item per line, not per marker");
    assert.equal(plain(items(out)[0]), "1. Vrai, dans 2. cas sur 3.");
  });

  test("keeps unlabelled lines as separate blocks", () => {
    const out = splitPerOptionExplanation("<p>Premier point.<br />Second point.</p>");
    assert.equal(out, "<p>Premier point.</p><p>Second point.</p>");
  });

  test("leaves an explanation that is already a list untouched", () => {
    const list = "<ul><li><strong>1.</strong> Vrai</li><li><strong>2.</strong> Faux</li></ul>";
    assert.equal(splitPerOptionExplanation(list), list);
  });

  test("leaves a single global explanation untouched", () => {
    const one = "<p>La radiographie montre un décollement complet.</p>";
    assert.equal(splitPerOptionExplanation(one), one);
    assert.equal(splitPerOptionExplanation(""), "");
  });

  test("leaves content already split across paragraphs untouched", () => {
    const two = "<p>1. Vrai.</p><p>2. Faux.</p>";
    assert.equal(splitPerOptionExplanation(two), two);
  });
});
