import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildQuestionUnits, questionNumbers } from "./questionChunks";
import { parseQuestionsLocally } from "./questionsFallback";

const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join("");
const plain = (html: string | null) =>
  (html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("no-AI parsing of a paper numbered twice", () => {
  // Taken from Pneumothorax.docx, where the compiler's own "Question 16"
  // heading sits above the original exam's "30." on the stem line. Counting
  // both as question starts split every such question into a heading with no
  // body (dropped outright) and a body labelled with the wrong number —
  // reported to the admin as "4 détectée(s), 2 lue(s)" with numbering
  // running 16, 30, 17, 31.
  const doubleNumbered = p(
    "<strong>Question 16</strong>",
    "30. Devant ce tableau radiologique, vous évoquez le diagnostic de :",
    "A. Pneumothorax spontané partiel.",
    "B. Bulle d'emphysème géante.",
    "C. Pneumothorax spontané total.",
    "Réponse : C",
    "<strong>Question 17</strong>",
    "31. Votre conduite à tenir consistera à :",
    "A. Repos strict.",
    "B. Exsufflation à l'aiguille.",
    "C. Pleurotomie a minima.",
    "Réponse : B",
  );

  test("reads one question per heading, not two", () => {
    assert.equal(buildQuestionUnits(doubleNumbered).length, 2);
    assert.equal(parseQuestionsLocally(doubleNumbered).length, 2);
  });

  test("loses none of them", () => {
    // The regression that prompted this: units detected but not parsed.
    assert.equal(
      parseQuestionsLocally(doubleNumbered).length,
      buildQuestionUnits(doubleNumbered).length,
    );
  });

  test("numbers them from the heading, contiguously", () => {
    assert.deepEqual(questionNumbers(doubleNumbered), [16, 17]);
  });

  test("keeps the stale exam number out of the stem", () => {
    const [first] = parseQuestionsLocally(doubleNumbered);
    assert.equal(
      plain(first.stem),
      "Devant ce tableau radiologique, vous évoquez le diagnostic de :",
    );
  });

  test("keeps every option and the answer key", () => {
    const [first, second] = parseQuestionsLocally(doubleNumbered);
    assert.equal(first.choices?.length, 3);
    assert.deepEqual(first.correct_indices, [2]);
    assert.deepEqual(second.correct_indices, [1]);
  });
});

// Guards on the filter that fixes the above: it must reject a numbered line
// ONLY when a heading directly precedes it.
describe("numbered question starts that must still count", () => {
  test("a paper numbered only in bare form", () => {
    const html = p(
      "1. Premier énoncé ?",
      "A. un",
      "B. deux",
      "2. Deuxième énoncé ?",
      "A. trois",
      "B. quatre",
    );
    assert.equal(parseQuestionsLocally(html).length, 2);
    assert.deepEqual(questionNumbers(html), [1, 2]);
  });

  test("a bare-numbered question following another question's options", () => {
    const html = p(
      "<strong>Question 1</strong>",
      "Premier énoncé ?",
      "A. un",
      "B. deux",
      "2. Deuxième énoncé ?",
      "A. trois",
      "B. quatre",
    );
    // The "2." is separated from the heading by option lines, so it opens a
    // real second question and must not be swallowed as a stem.
    assert.equal(parseQuestionsLocally(html).length, 2);
  });

  test("a numbered proposition list inside one stem stays in that stem", () => {
    const html = p(
      "<strong>Question 5</strong>",
      "Associer les éléments suivants :",
      "1. FNS",
      "2. CRP",
      "3. D-dimères",
      "A. 1+2",
      "B. 2+3",
      "Réponse : A",
    );
    const qs = parseQuestionsLocally(html);
    assert.equal(qs.length, 1);
    assert.equal(qs[0].choices?.length, 2, "only the lettered lines are options");
    assert.match(plain(qs[0].stem), /FNS/);
  });
});

// The .docx Step 2 writes puts a per-proposition explanation in ONE paragraph
// with soft breaks (see linesParagraph in questionsDocxBuilder.ts), so mammoth
// hands this shape to Step 3. Reading it through stripTags used to collapse
// the numbered items into a single run-on paragraph.
describe("an explanation written as lines stays lines", () => {
  const withExplanation =
    p(
      "<strong>Question 1</strong>",
      "Devant ce tableau, vous évoquez :",
      "A. Pneumothorax spontané partiel.",
      "B. Bulle d'emphysème géante.",
      "Réponse correcte : A",
    ) +
    "<p>Explication :<br />1. Vrai, le décollement est partiel.<br />2. Faux, la bulle est localisée.</p>";

  test("one paragraph per item", () => {
    const [q] = parseQuestionsLocally(withExplanation);
    const parts = (q.explanation ?? "").match(/<p>[\s\S]*?<\/p>/g) ?? [];
    assert.equal(parts.length, 2);
    assert.equal(plain(parts[0]), "1. Vrai, le décollement est partiel.");
    assert.equal(plain(parts[1]), "2. Faux, la bulle est localisée.");
  });

  test("the keyword itself is not kept as an item", () => {
    const [q] = parseQuestionsLocally(withExplanation);
    assert.doesNotMatch(plain(q.explanation ?? ""), /Explication/);
  });

  test("a single-line explanation is still one paragraph", () => {
    const html =
      p("<strong>Question 1</strong>", "Un énoncé ?", "A. un", "B. deux", "Réponse correcte : A") +
      "<p>Explication : la réponse A est la seule compatible.</p>";
    const [q] = parseQuestionsLocally(html);
    assert.equal(q.explanation, "<p>la réponse A est la seule compatible.</p>");
  });
});
