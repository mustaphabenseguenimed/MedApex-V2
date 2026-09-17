import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  looksLikeVignette,
  resolvePageCases,
  SAME_CASE_SIMILARITY,
  stripCaseLabel,
  vignetteSimilarity,
  withCleanCaseStem,
} from "./caseStem";

describe("stripCaseLabel", () => {
  // Every shape below was read off the Sarcoïdose PDF's own vignettes.
  test("removes the heading the source paper numbered its case with", () => {
    assert.equal(
      stripCaseLabel("Cas clinique N°12 : Patiente âgée de 60 ans, prothésiste dentaire."),
      "Patiente âgée de 60 ans, prothésiste dentaire.",
    );
    assert.equal(stripCaseLabel("CC7 : Une patiente de 32ans."), "Une patiente de 32ans.");
    assert.equal(stripCaseLabel("CC8: Patiente de 35 ans."), "Patiente de 35 ans.");
    assert.equal(stripCaseLabel("CC10: Une femme âgée de 42ans."), "Une femme âgée de 42ans.");
  });

  // Two of the real vignettes run the label straight into the text with no
  // separator at all.
  test("a label with no separator is still a label", () => {
    assert.equal(
      stripCaseLabel("Cas clinique N°6 Patiente âgée de 65 ans, sans profession."),
      "Patiente âgée de 65 ans, sans profession.",
    );
    assert.equal(
      stripCaseLabel("Cas clinique N°10 Patiente âgée 48 ans, enseignante."),
      "Patiente âgée 48 ans, enseignante.",
    );
  });

  test("reads the other wordings the app already recognises", () => {
    assert.equal(stripCaseLabel("Observation clinique n°3 - Homme de 40 ans."), "Homme de 40 ans.");
    assert.equal(stripCaseLabel("Vignette : Femme de 30 ans."), "Femme de 30 ans.");
    assert.equal(stripCaseLabel("Énoncé commun : Deux patients."), "Deux patients.");
  });

  test("a vignette with no label is left exactly as it is", () => {
    const stem = "Homme de 63 ans, retraité, ancien fonctionnaire administratif.";
    assert.equal(stripCaseLabel(stem), stem);
    assert.equal(stripCaseLabel("Patiente 30 ans, célibataire."), "Patiente 30 ans, célibataire.");
  });

  // "Cas clinique" followed by neither a number nor a separator is prose, and
  // eating those two words would mutilate the énoncé.
  test("prose that merely opens with the words is not a label", () => {
    const stem = "Cas clinique du patient précédent, revu à 6 mois.";
    assert.equal(stripCaseLabel(stem), stem);
  });

  test("a vignette that is nothing but its label is kept rather than emptied", () => {
    assert.equal(stripCaseLabel("Cas clinique n°3 :"), "Cas clinique n°3 :");
    assert.equal(stripCaseLabel("CC7 :"), "CC7 :");
  });

  test("inline markup around the label survives", () => {
    assert.equal(
      stripCaseLabel("<p><strong>Cas clinique N°5 : </strong>Monsieur AH, 67 ans.</p>"),
      "<p><strong></strong>Monsieur AH, 67 ans.</p>",
    );
    assert.equal(stripCaseLabel("<p>CC7 : Une patiente.</p>"), "<p>Une patiente.</p>");
  });

  test("nothing in, nothing out", () => {
    assert.equal(stripCaseLabel(null), null);
    assert.equal(stripCaseLabel(undefined), null);
    assert.equal(stripCaseLabel(""), "");
  });
});

describe("withCleanCaseStem", () => {
  test("cleans the vignette and leaves the rest of the question alone", () => {
    const q = { stem: "Quel diagnostic ?", case_stem: "CC7 : Une patiente de 32ans." };
    const out = withCleanCaseStem(q);
    assert.equal(out.case_stem, "Une patiente de 32ans.");
    assert.equal(out.stem, "Quel diagnostic ?");
  });

  test("a question with nothing to clean is returned untouched", () => {
    const q = { case_stem: "Homme de 63 ans." };
    assert.equal(withCleanCaseStem(q), q, "same object: no needless re-render");
    const noCase = { stem: "x", case_stem: null };
    assert.equal(withCleanCaseStem(noCase), noCase);
  });
});

describe("looksLikeVignette", () => {
  // Every vignette the Sarcoïdose paper actually has, as step 1 read them.
  const REAL_VIGNETTES = [
    "Homme de 63 ans, retraité, ancien fonctionnaire administratif, ex-fumeur à 30 PA (sevré de",
    "Une femme de 48 ans, veuve, femme au foyer, aux antécédents de sarcoïdose stade 2 diagnost",
    "Une femme de 48 ans, originaire et demeurant à Alger, mariée et mère de 03 enfants, sans a",
    "Femme de 50 ans, artisane, fumeuse à raison de 20 P/A, aux antécédents d'HTA depuis 5 ans,",
    "Un homme âgé de 68 ans, ancien fumeur (20 paquets-années, arrêté il y a 10 ans), aux antéc",
    "Femme de 65 ans, fumeuse à raison de 10 cigarettes/jour depuis 20 ans, directrice d'une cr",
    "Une femme de 42 ans, sans antécédents pathologiques, technicienne de santé, consulte pour ",
    "Femme de 65 ans, ex-agent administratif, fumeuse active (10 cigarettes/jour depuis 20 ans)",
    "Femme de 65 ans, ex-agent administratif, fumeuse active (10 cigarettes/jour depuis 20 ans)",
    "Patiente âgée de 60 ans, prothésiste dentaire à la retraite, suivie pour cardiopathie hype",
    "Patiente 30 ans, célibataire, sans antécédents pathologiques, consulte pour une toux sèche",
    "Monsieur AH âgé de 67 ans, fumeur 1 paquet/jours pendant 47 ans, retraité, ancien directeu",
    "Une femme de 48 ans, coiffeuse de profession, fumeuse à raison de 01 paquet par jour depui",
    "Une patiente de 32ans, originaire de Bejaia et demeurant à Alger, mariée et mère d'un enfa",
    "Patiente âgée 48 ans, enseignante dans une école, sans habitudes toxiques, suivie pour sar",
    "Patiente âgée de 65 ans, sans profession, traitée pour diabète type 2 et hypertension arté",
    "Patiente de 35 ans, enseignante de profession, tabagique à 10 cigarettes/j pendant 10 ans,",
    "Une femme âgée de 42ans, enseignante de profession, consulte pour toux sèche évoluant depu",
    "Un patient âgé 20 ans, ingénieur en informatique, non fumeur et suivi pour polyarthrite rh",
    "Femme de 55 ans, enseignante ,traitée pour sarcoïdose type IV, se plaint d'une toux sèche ",
  ];

  // Every stem the slicing turned into a spurious "clinical case" on that same
  // run: Commentaire prose, numbered continuations, sentences cut mid-flow.
  const FRAGMENTS = [
    "2. L'état actuel (Le virage vers la sévérité) : Elle consulte pour une détresse respiratoi",
    "19. Ce traitement a permis l'amélioration clinique de la patiente qui est revue en consult",
    "23. Les résultats des examens complémentaires vous parviennent: -Tubages gastriques à la r",
    "12. Les résultats des examens demandés: FNS : GB 9000/mm³ (PNN : 70 %, Lymphocyte : 22 %, ",
    "Résultats des examens demandés : TDM6 : interrompu après 1 minute 30 secondes, après désat",
    "16. Résultats des examens demandés : TDM6 : interrompu après 1 minute 30 secondes, après d",
    "la plus classique est le syndrome de Löfgren, qui associe une atteinte articulaire (arthra",
    "55. Vous recevez les résultats des examens demandés : - Spirométrie : CVF : 1,2 L (Théoriq",
    "Les résultats des examens sont : - Fibroscopie bronchique : muqueuse d'aspect normal, tous",
    "une cyanose des extrémités. La radiographie thoracique montre un aspect de rayons de miel,",
    "Le dosage de l'enzyme de conversion de l'Angiotensine est normal, le bilan phosphocalcique",
    "Les résultats des examens demandés vous parviennent : - ECG : rythme sinusal, PR=0,16S. On",
    "Les résultats des examens demandes vous parviennent: Gazométrie sanguine : PaO2 = 58mmHg, ",
    "Résultats des examens demandés sont les suivants : - FNS : GB :13 000élts/mm³(PN :73% , L ",
  ];

  test("accepts every real vignette in the file", () => {
    for (const stem of REAL_VIGNETTES) {
      assert.equal(looksLikeVignette(stem), true, `rejected a real vignette: ${stem.slice(0, 60)}`);
    }
  });

  test("rejects every fragment the slicing mistook for one", () => {
    for (const stem of FRAGMENTS) {
      assert.equal(looksLikeVignette(stem), false, `accepted a fragment: ${stem.slice(0, 60)}`);
    }
  });

  // The two that make the rule worth stating: they open with a determiner,
  // exactly like a vignette, and are caught only because they never give an age.
  test("a determiner alone is not enough", () => {
    assert.equal(
      looksLikeVignette("une cyanose des extrémités. La radiographie thoracique…"),
      false,
    );
    assert.equal(
      looksLikeVignette("la plus classique est le syndrome de Löfgren, qui associe…"),
      false,
    );
  });

  test("nothing is not a vignette", () => {
    assert.equal(looksLikeVignette(null), false);
    assert.equal(looksLikeVignette(undefined), false);
    assert.equal(looksLikeVignette(""), false);
    assert.equal(looksLikeVignette("<p></p>"), false);
  });

  test("markup around it changes nothing", () => {
    assert.equal(looksLikeVignette("<p><strong>Homme de 63 ans</strong>, retraité.</p>"), true);
  });
});

describe("resolvePageCases", () => {
  const q = (source_page: number, case_stem: string | null, id: string) => ({
    id,
    source_page,
    case_stem,
  });
  const VIGNETTE_A =
    "Homme de 63 ans, retraité, ancien fonctionnaire administratif, ex-fumeur à 30 PA, admis pour aggravation d'une dyspnée chronique évoluant depuis 6 mois.";
  /** The same case as the model recopied it for the next slice: one word. */
  const RETYPED_A =
    "Homme de 63 ans, retiré, ancien fonctionnaire administratif, ex-fumeur à 30 PA, admis pour aggravation d'une dyspnée chronique évoluant depuis 6 mois.";
  const VIGNETTE_B =
    "Femme de 42 ans, technicienne de santé, sans antécédents pathologiques, consulte pour une toux sèche évoluant depuis un mois.";
  const FRAGMENT = "12. Les résultats des examens demandés: FNS : GB 9000/mm³.";

  // The failure this exists for: a slice starting mid-page reports whatever
  // tops it as the case's énoncé, splitting one case into several.
  test("a fragment takes the vignette of its own page", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(1, FRAGMENT, "b"), q(1, null, "c")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, VIGNETTE_A, null],
      "a fragment inherits; a question with no stem at all is left alone",
    );
  });

  test("it only looks backwards, never at a case that starts later", () => {
    const out = resolvePageCases([q(1, FRAGMENT, "a"), q(1, VIGNETTE_A, "b")]);
    assert.equal(out[0].case_stem, null, "nothing had been seen yet when the fragment arrived");
    assert.equal(out[1].case_stem, VIGNETTE_A);
  });

  test("a page whose only stem is a fragment leaves its questions standalone", () => {
    const out = resolvePageCases([q(3, FRAGMENT, "a"), q(3, FRAGMENT, "b")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [null, null],
    );
  });

  // Page 8's vignette was visible in two overlapping slices and became two
  // "Cas clinique n°N" blocks holding halves of one case.
  test("one vignette read twice off overlapping slices collapses to one", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(1, RETYPED_A, "b")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, VIGNETTE_A],
      "the first reading stays canonical",
    );
  });

  // The context image shows the previous page's vignette again, and the copy
  // comes back stamped with the new page.
  test("the same vignette one page away is still the same case", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(2, VIGNETTE_A, "b")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, VIGNETTE_A],
    );
  });

  // Beyond one page it is a real second case, not an echo of the first: the
  // overlap and the context image cannot reach that far.
  test("but a re-typed vignette two pages away stays its own case", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(3, RETYPED_A, "b")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, RETYPED_A],
    );
  });

  test("a fragment on a page with no vignette takes the previous page's", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(2, FRAGMENT, "b")]);
    assert.equal(out[1].case_stem, VIGNETTE_A, "the case continued across the page break");
  });

  test("but never from two pages back", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(4, FRAGMENT, "b")]);
    assert.equal(out[1].case_stem, null);
  });

  test("two different patients on one page stay two cases", () => {
    const out = resolvePageCases([q(1, VIGNETTE_A, "a"), q(1, VIGNETTE_B, "b")]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, VIGNETTE_B],
    );
  });

  test("a question that needs no change keeps its identity", () => {
    const first = q(1, VIGNETTE_A, "a");
    const out = resolvePageCases([first]);
    assert.equal(out[0], first, "same object: no needless re-render");
  });

  test("questions with no page number are handled as one group, not crashed on", () => {
    const out = resolvePageCases([{ case_stem: VIGNETTE_A }, { case_stem: FRAGMENT }]);
    assert.deepEqual(
      out.map((x) => x.case_stem),
      [VIGNETTE_A, VIGNETTE_A],
    );
  });

  test("an empty list is an empty list", () => {
    assert.deepEqual(resolvePageCases([]), []);
  });
});

describe("vignetteSimilarity", () => {
  // The real pair that split case 1 in two: one word apart.
  const A =
    "Homme de 63 ans, retraité, ancien fonctionnaire administratif, ex-fumeur à 30 PA, admis pour aggravation d'une dyspnée chronique évoluant depuis 6 mois.";
  const RETYPED =
    "Homme de 63 ans, retiré, ancien fonctionnaire administratif, ex-fumeur à 30 PA, admis pour aggravation d'une dyspnée chronique évoluant depuis 6 mois.";
  // Two different cases from the same paper, both opening almost identically.
  const OTHER_48 =
    "Une femme de 48 ans, veuve, femme au foyer, aux antécédents de sarcoïdose stade 2 diagnostiquée il y a 5 ans, consulte pour aggravation de sa dyspnée.";
  const ALSO_48 =
    "Une femme de 48 ans, originaire et demeurant à Alger, mariée et mère de 03 enfants, sans antécédents médicaux, consulte pour toux sèche depuis 02 mois.";

  test("one re-typed word still reads as the same case", () => {
    assert.ok(
      vignetteSimilarity(A, RETYPED) >= SAME_CASE_SIMILARITY,
      `scored ${vignetteSimilarity(A, RETYPED)}`,
    );
  });

  test("identical text scores 1", () => {
    assert.equal(vignetteSimilarity(A, A), 1);
  });

  // The measurement that fixes the threshold: across the real run, two
  // different patients never exceeded 0.576 while two readings of one case
  // never fell below 0.977.
  test("two different patients stay well below the threshold", () => {
    const score = vignetteSimilarity(OTHER_48, ALSO_48);
    assert.ok(score < SAME_CASE_SIMILARITY, `scored ${score}`);
    assert.ok(score < 0.7, "and with room to spare");
  });

  test("nothing to compare never counts as a match", () => {
    assert.equal(vignetteSimilarity("", A), 0);
    assert.equal(vignetteSimilarity("Homme", A), 0, "one word has no pair to compare");
    assert.equal(vignetteSimilarity("", ""), 0);
  });

  test("markup and punctuation do not change the reading", () => {
    assert.equal(vignetteSimilarity(`<p>${A}</p>`, A), 1);
  });
});
