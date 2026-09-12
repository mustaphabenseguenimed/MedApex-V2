import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { answerLetters, parseAnswerVerdicts, sameAnswer } from "./answerVerdicts";

// Every question in these fixtures has four options (A-D).
const four = () => 4;

describe("parseAnswerVerdicts", () => {
  const cases: Array<
    [name: string, line: string, want: Partial<ReturnType<typeof parseAnswerVerdicts>[number]>[]]
  > = [
    [
      "a plain verdict",
      "[7] FINAL=B CONF=high WHY=la corticothérapie est contre-indiquée.",
      [
        {
          index: 7,
          final_indices: [1],
          confidence: "high",
          why: "la corticothérapie est contre-indiquée.",
        },
      ],
    ],
    [
      "adjacent letters",
      "[3] FINAL=AC CONF=medium WHY=les deux",
      [{ index: 3, final_indices: [0, 2] }],
    ],
    ["separated letters", "[2] FINAL=A, C CONF=low WHY=hmm", [{ index: 2, final_indices: [0, 2] }]],
    [
      "an explicit no-call",
      "[5] FINAL=- CONF=low WHY=sources contradictoires",
      [{ index: 5, final_indices: null }],
    ],
    [
      "a line wrapped in markdown",
      "- Voici: `[9] FINAL=D CONF=high WHY=référence 2024`",
      [{ index: 9, final_indices: [3], why: "référence 2024" }],
    ],
    [
      "a missing CONF (treated as low)",
      "[1] FINAL=A WHY=parce que",
      [{ index: 1, confidence: "low" }],
    ],
    [
      "several lines at once",
      "[0] FINAL=A CONF=high WHY=x\n[1] FINAL=B CONF=medium WHY=y",
      [
        { index: 0, final_indices: [0] },
        { index: 1, final_indices: [1] },
      ],
    ],
  ];
  for (const [name, line, want] of cases) {
    test(`reads ${name}`, () => {
      const got = parseAnswerVerdicts(line, four);
      assert.equal(got.length, want.length);
      want.forEach((w, i) => assert.deepEqual({ ...got[i], ...w }, got[i]));
    });
  }

  // The whole point of the strict parse: an unreadable line must yield no
  // verdict, because a misread one would silently rewrite a correct answer.
  const rejected: Array<[string, string]> = [
    ["a letter past the last option", "[4] FINAL=Z CONF=high WHY=nope"],
    ["prose with no verdict at all", "je ne peux pas répondre à cette question"],
    ["an index with no FINAL", "[4] la réponse est difficile à établir"],
  ];
  for (const [name, line] of rejected) {
    test(`ignores ${name}`, () => assert.deepEqual(parseAnswerVerdicts(line, four), []));
  }

  test("does not read the next field as answer letters", () => {
    // "FINAL=B CONF=high" must be B, never B+C from the word CONF.
    assert.deepEqual(
      parseAnswerVerdicts("[0] FINAL=B CONF=high WHY=x", four)[0].final_indices,
      [1],
    );
  });
});

describe("sameAnswer", () => {
  test("ignores order and duplicates", () => {
    assert.equal(sameAnswer([2, 0], [0, 2, 2]), true);
    assert.equal(sameAnswer([0], [1]), false);
  });
  test("treats null and empty as equal", () => {
    assert.equal(sameAnswer(null, []), true);
    assert.equal(sameAnswer(null, [0]), false);
  });
});

describe("answerLetters", () => {
  test("formats a key for the admin", () => {
    assert.equal(answerLetters([0]), "A");
    assert.equal(answerLetters([0, 2]), "AC");
    assert.equal(answerLetters(null), "?");
    assert.equal(answerLetters([]), "?");
  });
});
