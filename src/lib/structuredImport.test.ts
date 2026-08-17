import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { detectStemMarkers, parseQuestionsJson } from "./structuredImport";
import { canonicalRotationKey, matchRotations, parseYears } from "./importMatch";

const question = (stem: string, extra: Record<string, unknown> = {}) => ({
  stem,
  choices: ["A", "B"],
  correct: [0],
  ...extra,
});

describe("JSON stem rotation and year detection", () => {
  const cases: Array<[string, string, string]> = [
    ["p3 2026, Question test", "P3 2026", "2026"],
    ["p5 2025: Question test", "P5 2025", "2025"],
    ["rattrapage 2024 - Question test", "Rattrapage 2024", "2024"],
    ["<p>p3 2026, Question test</p>", "P3 2026", "2026"],
    ["• P3-2026 — Question test", "P3 2026", "2026"],
    ["12. **P5:2025** : Question test", "P5 2025", "2025"],
    ["P32026, Question test", "P3 2026", "2026"],
    ["Pôle n°12 2026 : Question test", "P12 2026", "2026"],
  ];
  for (const [stem, rotation, year] of cases) {
    test(`detects ${stem}`, () => {
      const detected = detectStemMarkers(stem);
      assert.deepEqual(detected.rotation_hints, [rotation]);
      assert.deepEqual(detected.year_hints, [year]);
    });
  }

  test("explicit Rotation/Year fields win over the stem", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      question("p3 2026, Question test", {
        module: "Cardiologie",
        session: "Session 2",
        Rotation: "P5, 2025",
        Year: "2025",
      }),
    ]));

    assert.equal(parsed.rotation_hint, "P5 2025");
    assert.deepEqual(parsed.rotation_hints, ["P5 2025"]);
    assert.equal(parsed.year_hint, "2025");
    assert.deepEqual(parsed.year_hints, ["2025"]);
  });

  test("new field structure: Rotation 'Pn, year' + Year", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      { Rotation: "P3, 2026", Year: "2026", stem: "Question test", choices: ["A", "B"], correct_indices: [0], explanation: "x" },
      { Rotation: "Rattrapage 2024", Year: "2024", stem: "Autre question", choices: ["A", "B"], correct_indices: [1] },
    ]));

    assert.deepEqual(parsed.rotation_hints, ["P3 2026"]);
    assert.deepEqual(parsed.year_hints, ["2026"]);
  });

  test("accepts the exact structure as a single JSON object", () => {
    const parsed = parseQuestionsJson(JSON.stringify({
      Rotation: "P3, 2026",
      Year: "2026",
      stem: "Question test",
      choices: ["A", "B", "C", "D", "E"],
      correct_indices: [0],
      explanation: "Explication",
    }));

    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0].rotation_hints, ["P3 2026"]);
    assert.deepEqual(parsed[0].year_hints, ["2026"]);
    assert.equal(parsed[0].detection_snippet, "Rotation: P3, 2026 · Year: 2026");
  });

  test("normalizes dedicated fields and supports multiple values", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      question("P1 2022: marker in stem", {
        rotation_hints: ["P3", "Rattrapage 2026"],
        year_hints: [2025, "2026"],
      }),
    ]));

    assert.deepEqual(parsed.rotation_hints, ["P3 2026", "Rattrapage 2026"]);
    assert.deepEqual(parsed.year_hints, ["2025", "2026"]);
    assert.equal(parsed.year_hint, "2026");
  });

  test("resolves explicit metadata through the complete review matching step", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      question("Question test", { Rotation: "P3, 2026", Year: 2026 }),
    ]));
    const rotations = [
      { id: "p3-2025", label: "P3 2025" },
      { id: "p3-2026", label: "P3 2026" },
    ];
    const years = parseYears(parsed.year_hints ?? [parsed.year_hint], parsed.year_hint);

    assert.deepEqual(years, [2026]);
    assert.deepEqual(matchRotations(parsed.rotation_hints, rotations, { years }), ["p3-2026"]);
    assert.deepEqual(matchRotations(["P4 2026"], rotations, { years }), []);
  });

  test("preserves multiple markers and exposes the latest year", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      question("P3 2024, P5 2026: Question test"),
    ]));

    assert.deepEqual(parsed.rotation_hints, ["P3 2024", "P5 2026"]);
    assert.deepEqual(parsed.year_hints, ["2024", "2026"]);
    assert.equal(parsed.year_hint, "2026");
  });

  test("uses precise metadata only when the stem has no marker", () => {
    const [parsed] = parseQuestionsJson(JSON.stringify([
      question("Question test", { rotation_hint: "P5 2025", exam_year: 2025 }),
    ]));

    assert.deepEqual(parsed.rotation_hints, ["P5 2025"]);
    assert.deepEqual(parsed.year_hints, ["2025"]);
  });

  test("matches canonical rotation identities without cross-year fallback", () => {
    const rotations = [
      { id: "p3-2025", label: "P3 2025" },
      { id: "p3-2026", label: "P3 2026" },
      { id: "rat-2026", label: "Rattrapage 2026" },
    ];
    assert.equal(canonicalRotationKey("Pôle 3:2026"), "pole:3:2026");
    assert.deepEqual(matchRotations(["P3 2026", "Rattrapage 2026"], rotations), ["p3-2026", "rat-2026"]);
    assert.deepEqual(matchRotations(["P3 2024"], rotations), []);
  });
});