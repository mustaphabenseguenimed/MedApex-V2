import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { alignByStems, buildQuestionUnits, chunkUnits } from "./questionChunks";

describe("alignByStems", () => {
  test("matches each question back to its own source, in order", () => {
    const source = [
      "Question 1 Quel est le diagnostic le plus probable devant ce tableau radio-clinique ? A. Pneumonie",
      "Question 2 Quels examens complémentaires demandez-vous en première intention ? A. FNS + CRP",
    ];
    const aiStems = [
      "Quel est le diagnostic le plus probable devant ce tableau radio-clinique ?",
      "Quels examens complémentaires demandez-vous en première intention ?",
    ];
    assert.deepEqual(alignByStems(aiStems, source), [0, 1]);
  });

  /**
   * The failure this function was rewritten for. `PreparedChunk.stems` holds
   * the first 140 characters of a unit — heading, stem, and the start of the
   * options — while the AI returns the whole stem. Scoring the overlap against
   * the larger of the two sets made a long stem unmatchable however perfect
   * the match, which is how a question lost the clinical case its document had
   * put it in.
   */
  test("a long stem still matches the truncated source it came from", () => {
    const aiStem =
      "Résultats des examens : TDM thoracique : multiples adénopathies hilaires bilatérales " +
      "non compressives, micronodules péri-lymphatiques diffus, pas de foyer parenchymateux ; " +
      "spirométrie : CVF 78 % de la théorique, VEMS 82 %, rapport conservé ; gazométrie " +
      "artérielle en air ambiant : pH 7,41, PaO2 78 mmHg, PaCO2 38 mmHg, bicarbonates 24 mmol/l";
    const source = [
      "Question 50 Résultats des examens : TDM thoracique : multiples adénopathies hilaires bilatérales non compressives, micronodules péri-l",
    ];
    assert.deepEqual(alignByStems([aiStem], source), [0]);
  });

  // What the function exists for: the AI drops one of a chunk's questions, and
  // zipping by index would then shift every context after it onto the wrong
  // question.
  test("the questions after a dropped one keep their own source", () => {
    const source = [
      "Question 1 Quel est le diagnostic le plus probable ?",
      "Question 2 Quels examens complémentaires demandez-vous ?",
      "Question 3 Quelle est votre conduite thérapeutique ?",
    ];
    assert.deepEqual(
      alignByStems(
        ["Quel est le diagnostic le plus probable ?", "Quelle est votre conduite thérapeutique ?"],
        source,
      ),
      [0, 2],
    );
  });

  test("a question the source does not contain matches nothing", () => {
    const source = ["Question 1 Quel est le diagnostic le plus probable ?"];
    assert.deepEqual(alignByStems(["Citez les trois stades de la maladie de Hodgkin"], source), [
      null,
    ]);
  });

  // Containment scores generously — every word of the shorter side can be
  // present in the longer — so a stem of two or three words would otherwise
  // reach 1.0 on nothing at all. MIN_ALIGN_TOKENS is the denominator's floor,
  // and it is what keeps such a stem below the bar.
  test("a stem of a couple of words is not matched on them alone", () => {
    const source = [
      "Question 7 Quels sont les examens complémentaires à demander en urgence chez ce patient ?",
    ];
    assert.deepEqual(alignByStems(["Quel diagnostic ?"], source), [null]);
  });

  // A match can never point back before the previous one, so the AI's order
  // is always the document's order.
  test("matching never runs backwards", () => {
    const source = [
      "Question 1 Quel est le diagnostic le plus probable devant ce tableau ?",
      "Question 2 Quelle est votre conduite thérapeutique immédiate ?",
    ];
    const out = alignByStems(
      [
        "Quelle est votre conduite thérapeutique immédiate ?",
        "Quel est le diagnostic le plus probable devant ce tableau ?",
      ],
      source,
    );
    assert.equal(out[0], 1);
    assert.equal(out[1], null, "the second cannot match a source before the first");
  });

  test("nothing to match against is nothing matched", () => {
    assert.deepEqual(alignByStems(["Quel est le diagnostic ?"], []), [null]);
    assert.deepEqual(alignByStems([], ["Question 1 Quel est le diagnostic ?"]), []);
  });
});

/**
 * The whole path step 3 runs: read a generated .docx back, cut it into chunks,
 * then put the AI's answers back onto the units they came from. A clinical
 * case only survives that round trip if every one of its questions finds its
 * own unit again.
 */
describe("a case survives the chunk round trip", () => {
  const html = [
    "<p>Cas clinique n°1 :</p>",
    "<p>Homme de 63 ans, ex-fumeur à 30 PA, admis pour une dyspnée d'effort évoluant depuis 6 mois.</p>",
    "<p>Question 1</p>",
    "<p>Quel diagnostic est le plus probable devant ce tableau radio-clinique ?</p>",
    "<p>A. Pneumonie interstitielle</p>",
    "<p>B. Pneumopathie infiltrante diffuse</p>",
    "<p>Réponse correcte : B</p>",
    "<p>Question 2</p>",
    "<p>Résultats des examens : FNS : GB 9500/mm3, Hb 13 g/dl, plaquettes 250.000/mm3 ; CRP 15 mg/l ; spirométrie : CVF à 65 % de la théorique, VEMS à 70 % ; gazométrie artérielle : pH 7,42, PaO2 55 mmHg, PaCO2 34 mmHg. Comment interprétez-vous ces résultats ?</p>",
    "<p>A. Hypoxémie + hypocapnie</p>",
    "<p>B. Hypoxémie + acidose respiratoire</p>",
    "<p>Réponse correcte : A</p>",
  ].join("\n");

  test("every question of the case carries the case, chunked or not", () => {
    const units = buildQuestionUnits(html, true);
    assert.equal(units.length, 2);
    const vignette = units[0].header.case_stem;
    assert.ok(vignette, "the document's own marker gives the case");
    assert.equal(units[1].header.case_stem, vignette, "including its last question");
  });

  // The long "Résultats des examens" stem is exactly the shape that used to
  // match nothing and so lost its case on the way back in.
  test("the AI's answers land back on their own units", () => {
    const units = buildQuestionUnits(html, true);
    const [chunk] = chunkUnits(units, 4);
    const aiStems = [
      "Quel diagnostic est le plus probable devant ce tableau radio-clinique ?",
      "Résultats des examens : FNS : GB 9500/mm3, Hb 13 g/dl, plaquettes 250.000/mm3 ; CRP 15 mg/l ; spirométrie : CVF à 65 % de la théorique, VEMS à 70 % ; gazométrie artérielle : pH 7,42, PaO2 55 mmHg, PaCO2 34 mmHg. Comment interprétez-vous ces résultats ?",
    ];
    assert.deepEqual(alignByStems(aiStems, chunk.stems), [0, 1]);
  });
});
