import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtractedQ } from "./questions.functions";
import { caseHintsOnLead, toJsonObjects, withoutRotationHints } from "./questionsJson";
import { parseQuestionsJson } from "./structuredImport";

const q = (over: Partial<ExtractedQ> = {}): ExtractedQ => ({
  type: "qcs",
  stem: "Un énoncé ?",
  choices: ["un", "deux"],
  correct_indices: [0],
  model_answer: null,
  explanation: null,
  case_stem: null,
  rotation_hint: null,
  year_hint: null,
  ...over,
});

/** The exported objects, as plain records for field-by-field assertions. */
const exported = (items: ExtractedQ[]) => toJsonObjects(items) as Record<string, unknown>[];
const field = (node: Record<string, unknown>, key: string) => String(node[key] ?? "");
const subQuestions = (node: Record<string, unknown>) =>
  (node.questions as Record<string, unknown>[]) ?? [];

/** Export, then read back the way step 4 and the import do. */
const roundTrip = (items: ExtractedQ[]) =>
  parseQuestionsJson(JSON.stringify(toJsonObjects(items), null, 2));

const VIGNETTE =
  "Un patient de 24 ans, sans antécédents notables, consulte aux urgences pour une douleur " +
  "thoracique droite d'apparition brutale, accompagnée d'une dyspnée. L'examen retrouve un " +
  "tympanisme et une abolition du murmure vésiculaire.";

describe("clinical case énoncé in the generated .json", () => {
  const cas = [
    q({ case_stem: VIGNETTE, stem: "Quel diagnostic ?", rotation_hint: "P3", year_hint: "2024" }),
    q({ case_stem: VIGNETTE, stem: "Quelle conduite à tenir ?" }),
  ];

  // The reported bug: the énoncé was written from the GROUPING key, which is
  // lowercased and cut to 80 characters, so every case in every downloaded
  // .json carried a truncated, lowercase vignette.
  test("is exported whole, not cut to the grouping key", () => {
    const [node] = exported(cas);
    assert.equal(node["cas clinique stem"], VIGNETTE);
    assert.ok(VIGNETTE.length > 80, "fixture must be longer than the grouping key");
  });

  test("keeps its capitalisation through the round trip", () => {
    const back = roundTrip(cas);
    assert.equal(back[0].case_stem, VIGNETTE);
    assert.equal(back[1].case_stem, VIGNETTE);
  });

  test("sub-questions stay under one case, with the rotation at case level", () => {
    const [node] = exported(cas);
    assert.equal(subQuestions(node).length, 2);
    assert.equal(node.Rotation, "P3");
    assert.equal(node.Year, "2024");
    const back = roundTrip(cas);
    assert.equal(back.length, 2);
    // The reader folds the year into the rotation hint ("P3" + Year 2024), so
    // match on the rotation itself rather than the exact combined string.
    assert.match(back[0].rotation_hint ?? "", /^P3\b/);
    assert.equal(back[0].year_hint, "2024");
  });
});

describe("what a question keeps through the .json", () => {
  test("a QROC keeps its answer", () => {
    const [back] = roundTrip([
      q({ type: "qroc", choices: null, correct_indices: null, model_answer: "Le pneumothorax." }),
    ]);
    assert.equal(back.type, "qroc");
    assert.equal(back.model_answer, "Le pneumothorax.");
  });

  test("a QCM with a single correct answer is still a QCM", () => {
    const [back] = roundTrip([
      q({ type: "qcm", choices: ["un", "deux", "trois"], correct_indices: [1] }),
    ]);
    assert.equal(back.type, "qcm");
    assert.deepEqual(back.correct_indices, [1]);
  });

  test("an image in a stem survives", () => {
    const stem = 'Que montre ce cliché ? <img src="storage://explanation-images/a.png">';
    const [node] = exported([q({ stem })]);
    assert.match(field(node, "stem"), /<img/);
    assert.match(roundTrip([q({ stem })])[0].stem, /<img/);
  });

  test("an association question keeps its lines", () => {
    const stem = "Associer :<br />1. FNS<br />2. CRP";
    const [node] = exported([q({ stem })]);
    assert.equal((field(node, "stem").match(/<br/g) ?? []).length, 2);
  });

  test("a plain stem stays plain text, with no markup churn", () => {
    const [node] = exported([q({ stem: "<p>Un <strong>énoncé</strong> simple ?</p>" })]);
    assert.equal(node.stem, "Un énoncé simple ?");
  });

  test("the cours follows the question", () => {
    const [back] = roundTrip([q({ course_hint: "Pneumologie" })]);
    assert.equal(back.course_hint, "Pneumologie");
  });

  test("a per-proposition explanation keeps its list", () => {
    const explanation =
      "<ul><li><strong>1.</strong> Vrai</li><li><strong>2.</strong> Faux</li></ul>";
    assert.match(roundTrip([q({ explanation })])[0].explanation ?? "", /<li>/);
  });
});

describe("caseHintsOnLead", () => {
  const cas = (stem: string, over: Partial<ExtractedQ> = {}) =>
    q({ case_stem: VIGNETTE, stem, rotation_hint: "P3", year_hint: "2024", ...over });

  // Step 4's "Appliquer" writes the rotation on the lead, but the document's
  // own "Rotation : P3 2024" line is attached to every unit read under it, so
  // sub-questions arrive already carrying one.
  test("only the case's first question keeps rotation and année", () => {
    const out = caseHintsOnLead([cas("Q1"), cas("Q2"), cas("Q3")]);
    assert.equal(out[0].rotation_hint, "P3");
    assert.equal(out[0].year_hint, "2024");
    assert.deepEqual(
      out.slice(1).map((x) => [x.rotation_hint, x.year_hint]),
      [
        [null, null],
        [null, null],
      ],
    );
  });

  test("multi-value hints are cleared on sub-questions too", () => {
    const out = caseHintsOnLead([
      cas("Q1", { rotation_hints: ["P3", "P4"], year_hints: ["2023", "2024"] }),
      cas("Q2", { rotation_hints: ["P3", "P4"], year_hints: ["2023", "2024"] }),
    ]);
    assert.deepEqual(out[0].rotation_hints, ["P3", "P4"]);
    assert.equal(out[1].rotation_hints, null);
    assert.equal(out[1].year_hints, null);
  });

  test("standalone questions keep their own rotation", () => {
    const out = caseHintsOnLead([
      q({ rotation_hint: "P2", year_hint: "2023" }),
      q({ rotation_hint: "P3", year_hint: "2024" }),
    ]);
    assert.deepEqual(
      out.map((x) => x.rotation_hint),
      ["P2", "P3"],
    );
  });

  test("a second case gets its own lead", () => {
    const other = "Une femme de 60 ans, diabétique, consulte pour une plaie du pied.";
    const out = caseHintsOnLead([
      cas("Q1"),
      cas("Q2"),
      q({ case_stem: other, rotation_hint: "P4", year_hint: "2025" }),
      q({ case_stem: other, rotation_hint: "P4", year_hint: "2025" }),
    ]);
    assert.equal(out[1].rotation_hint, null);
    assert.equal(out[2].rotation_hint, "P4");
    assert.equal(out[3].rotation_hint, null);
  });

  test("leaves the input array untouched", () => {
    const items = [cas("Q1"), cas("Q2")];
    caseHintsOnLead(items);
    assert.equal(items[1].rotation_hint, "P3");
  });
});

describe("withoutRotationHints", () => {
  // Step 1 writes no rotation at all: what the model reads off a page is a
  // guess, and once it lands in the .docx every later step attaches it to the
  // questions read underneath it.
  test("clears every rotation and année hint", () => {
    const [out] = withoutRotationHints([
      q({
        rotation_hint: "P3",
        year_hint: "2024",
        rotation_hints: ["P3", "P4"],
        year_hints: ["2023", "2024"],
      }),
    ]);
    assert.equal(out.rotation_hint, null);
    assert.equal(out.year_hint, null);
    assert.equal(out.rotation_hints, null);
    assert.equal(out.year_hints, null);
  });

  test("changes nothing else", () => {
    const before = q({
      stem: "Un énoncé ?",
      case_stem: VIGNETTE,
      course_hint: "Pneumologie",
      rotation_hint: "P3",
    });
    const [after] = withoutRotationHints([before]);
    assert.equal(after.stem, before.stem);
    assert.equal(after.case_stem, VIGNETTE);
    assert.equal(after.course_hint, "Pneumologie");
    assert.deepEqual(after.choices, before.choices);
  });

  test("leaves a question that has no hint untouched", () => {
    const items = [q()];
    assert.equal(withoutRotationHints(items)[0], items[0], "same object, no needless copy");
  });

  test("does not mutate the input", () => {
    const items = [q({ rotation_hint: "P3", year_hint: "2024" })];
    withoutRotationHints(items);
    assert.equal(items[0].rotation_hint, "P3");
  });

  // With no hints left, combinedRotation() returns null in toDocxItems and
  // rotationParagraph writes nothing — that is how the .docx loses its
  // "Rotation :" line.
  test("a stripped question exports no Rotation in the .json either", () => {
    const [node] = exported(withoutRotationHints([q({ rotation_hint: "P3", year_hint: "2024" })]));
    assert.equal(node.Rotation, "");
    assert.equal(node.Year, "");
  });
});
