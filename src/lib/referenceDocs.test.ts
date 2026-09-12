import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildReferenceBlock } from "./referenceDocs";

const doc = (name: string, length: number, fill = "x") => ({ name, text: fill.repeat(length) });
/** Length of document text actually included, ignoring labels and markers. */
const bodyLength = (block: string, name: string) => {
  const section = block.split("\n\n").find((s) => s.startsWith(`=== ${name} ===`));
  if (!section) return 0;
  return section.replace(`=== ${name} ===\n`, "").replace(/\n…\[document tronqué\]$/, "").length;
};

describe("buildReferenceBlock", () => {
  test("keeps every document whole when the total fits", () => {
    const { block, truncated } = buildReferenceBlock([doc("a.pdf", 100), doc("b.docx", 200)], 1000);
    assert.deepEqual(truncated, []);
    assert.equal(bodyLength(block, "a.pdf"), 100);
    assert.equal(bodyLength(block, "b.docx"), 200);
  });

  test("labels each document by name, in the caller's order", () => {
    const { block } = buildReferenceBlock([doc("second", 10), doc("first", 10)], 1000);
    assert.match(block, /^=== second ===/);
    assert.ok(block.indexOf("=== second ===") < block.indexOf("=== first ==="));
  });

  // The whole point of the module: the old concatenate-then-slice approach
  // gave the first document everything and the rest nothing.
  test("never lets one long document starve the others", () => {
    const { block, truncated } = buildReferenceBlock(
      [doc("huge.pdf", 10_000), doc("small.docx", 300)],
      1000,
    );
    assert.equal(bodyLength(block, "small.docx"), 300, "short doc kept whole");
    assert.equal(bodyLength(block, "huge.pdf"), 700, "long doc gets the rest");
    assert.deepEqual(truncated, ["huge.pdf"]);
  });

  test("passes a short document's unused share to the longer ones", () => {
    // Equal shares would be 100 each; the 10-char doc releases 90.
    const { block } = buildReferenceBlock(
      [doc("tiny", 10), doc("big1", 500), doc("big2", 500)],
      300,
    );
    assert.equal(bodyLength(block, "tiny"), 10);
    assert.equal(bodyLength(block, "big1") + bodyLength(block, "big2"), 290);
  });

  test("marks a cut document instead of stopping mid-sentence", () => {
    const { block } = buildReferenceBlock([doc("cut.pdf", 500)], 100);
    assert.ok(block.endsWith("…[document tronqué]"));
  });

  test("a single document reduces to a plain labelled slice", () => {
    const { block, truncated } = buildReferenceBlock([{ name: "notes", text: "abc" }], 1000);
    assert.equal(block, "=== notes ===\nabc");
    assert.deepEqual(truncated, []);
  });

  test("ignores empty and whitespace-only documents", () => {
    const { block } = buildReferenceBlock(
      [
        { name: "blank", text: "   " },
        { name: "real", text: "content" },
      ],
      1000,
    );
    assert.equal(block, "=== real ===\ncontent");
  });

  test("two files sharing a name are both kept", () => {
    const { block } = buildReferenceBlock(
      [doc("cours.pdf", 50, "a"), doc("cours.pdf", 50, "b")],
      1000,
    );
    assert.equal(block.match(/=== cours\.pdf ===/g)?.length, 2);
    assert.ok(block.includes("a".repeat(50)) && block.includes("b".repeat(50)));
  });

  test("nothing in, nothing out", () => {
    assert.deepEqual(buildReferenceBlock([], 1000), { block: "", truncated: [] });
    assert.deepEqual(buildReferenceBlock([doc("a", 10)], 0), { block: "", truncated: [] });
  });
});
