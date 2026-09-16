import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { stripCaseLabel, withCleanCaseStem } from "./caseStem";

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
