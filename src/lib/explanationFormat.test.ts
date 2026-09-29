import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  explanationLines,
  propositionStyle,
  relabelPropositions,
  splitPerOptionExplanation,
} from "./explanationFormat";

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

describe("propositionStyle", () => {
  test("an ordinary question is lettered, one label per option", () => {
    assert.deepEqual(
      propositionStyle({
        stem: "Ce tableau radio-clinique vous évoque en premier lieu le diagnostic de :",
        choices: ["Pneumopathie interstitielle commune", "Asbestose", "Silicose"],
      }),
      { kind: "letters", count: 3 },
    );
  });

  // An association question's options are combinations ("1+2", "2+3") and
  // explain nothing on their own; what gets justified is the énoncé's list.
  test("a numbered list in the énoncé makes it numbered", () => {
    assert.deepEqual(
      propositionStyle({
        stem: "Quels sont les examens à demander en priorité ?<br>1. Gazométrie artérielle<br>2. ECG<br>3. Bilan rénal<br>4. FNS<br>5. D-Dimères",
        choices: ["1+2", "2+3", "4+5", "2+4", "1+4"],
      }),
      { kind: "numbers", count: 5 },
    );
  });

  test("a figure in the prose is not a list", () => {
    const stem =
      "Gazométrie artérielle : pH : 7,24, PaO2 : 67 mmHg, PaCO2 : 75 mmHg. Quel est le diagnostic ?";
    assert.equal(propositionStyle({ stem, choices: ["a", "b"] }).kind, "letters");
  });

  test("a run that does not start at 1 is not a list either", () => {
    const stem = "Commentaire. 3. Une remarque. 7. Une autre.";
    assert.equal(propositionStyle({ stem, choices: ["a", "b"] }).kind, "letters");
  });
});

describe("relabelPropositions", () => {
  const LIST =
    "<ul><li><strong>1.</strong> Faux. Les lésions prédominent aux bases.</li>" +
    "<li><strong>2.</strong> Vrai. L'association est caractéristique.</li>" +
    "<li><strong>3.</strong> Faux. Le contexte évoque l'amiante.</li></ul>";

  // The reported bug: an A-to-E question came back with its justifications
  // numbered, because step 2 asked for numbers whatever the question was.
  test("numbers become the letters the reader is looking at", () => {
    const out = relabelPropositions(LIST, { kind: "letters", count: 3 });
    assert.match(out, /<strong>A\.<\/strong> Faux\./);
    assert.match(out, /<strong>B\.<\/strong> Vrai\./);
    assert.match(out, /<strong>C\.<\/strong> Faux\./);
    assert.ok(!/<strong>1\./.test(out), "no number survives");
  });

  test("an association question keeps its numbers", () => {
    assert.equal(relabelPropositions(LIST, { kind: "numbers", count: 3 }), LIST);
  });

  test("the wording and the markup are untouched", () => {
    const out = relabelPropositions(LIST, { kind: "letters", count: 3 });
    assert.ok(out.includes("Les lésions prédominent aux bases."));
    assert.equal((out.match(/<li>/g) ?? []).length, 3);
  });

  test("the paragraph-and-rule shape is relabelled too", () => {
    const html = "<p><strong>1.</strong> Faux.</p><hr /><p><strong>2.</strong> Vrai.</p>";
    const out = relabelPropositions(html, { kind: "letters", count: 2 });
    assert.match(out, /<strong>A\.<\/strong> Faux\./);
    assert.match(out, /<strong>B\.<\/strong> Vrai\./);
    assert.ok(out.includes("<hr />"), "the separator survives");
  });

  /**
   * Positional is the only sound mapping, so it must not be applied to a list
   * that does not line up: moving a justification onto the wrong option is
   * worse than leaving it numbered.
   */
  test("a list that does not match the question is left alone", () => {
    assert.equal(relabelPropositions(LIST, { kind: "letters", count: 5 }), LIST);
  });

  test("a single global explanation is left alone", () => {
    const prose = "<p>L'asbestose est évoquée par les plaques pleurales.</p>";
    assert.equal(relabelPropositions(prose, { kind: "letters", count: 5 }), prose);
  });

  test("an item with no label at all is left alone", () => {
    const html = "<ul><li>Faux.</li><li>Vrai.</li></ul>";
    assert.equal(relabelPropositions(html, { kind: "letters", count: 2 }), html);
  });

  test("nothing to relabel is nothing done", () => {
    assert.equal(relabelPropositions("", { kind: "letters", count: 5 }), "");
    assert.equal(relabelPropositions(LIST, { kind: "letters", count: 1 }), LIST);
  });
});
