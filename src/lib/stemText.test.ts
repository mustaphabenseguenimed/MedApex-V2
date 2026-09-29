import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { editableToStem, stemToEditable } from "./stemText";

const STEM =
  "Quelles sont les mesures prioritaires à prendre chez ce patient?<br />1. Déclaration de la " +
  "maladie professionnelle<br />2. Changement de poste de travail<br />3. Vaccination antigrippale";

describe("editing an énoncé", () => {
  // What the admin used to be shown: the tags as literal text, mid-sentence.
  test("line breaks read as line breaks", () => {
    const shown = stemToEditable(STEM);
    assert.ok(!shown.includes("<br"), "no tag survives into the field");
    assert.deepEqual(shown.split("\n").length, 4);
    assert.ok(shown.startsWith("Quelles sont les mesures prioritaires"));
    assert.ok(shown.includes("\n1. Déclaration de la maladie professionnelle"));
  });

  test("and are stored as line breaks again", () => {
    assert.equal(editableToStem(stemToEditable(STEM)), STEM);
  });

  // Every keystroke round-trips through both, so what the admin typed has to
  // come back unchanged or the cursor jumps.
  test("what was typed comes back exactly", () => {
    for (const typed of [
      "Une question sur une seule ligne",
      "Deux lignes\nla seconde",
      "",
      "Un chevron < qui n'ouvre rien",
      "Trois\nlignes\nd'affilée",
    ]) {
      assert.equal(stemToEditable(editableToStem(typed)), typed);
    }
  });

  test("the tag's other spellings are read too", () => {
    assert.equal(stemToEditable("a<br>b<br/>c<BR />d"), "a\nb\nc\nd");
  });

  test("markup that is not a line break is left alone", () => {
    const rich = 'Voir <strong>la radio</strong> :<br /><img src="x.png" />';
    assert.equal(stemToEditable(rich), 'Voir <strong>la radio</strong> :\n<img src="x.png" />');
    assert.equal(editableToStem(stemToEditable(rich)), rich);
  });

  test("nothing is nothing", () => {
    assert.equal(stemToEditable(null), "");
    assert.equal(stemToEditable(undefined), "");
    assert.equal(editableToStem(""), "");
  });
});
