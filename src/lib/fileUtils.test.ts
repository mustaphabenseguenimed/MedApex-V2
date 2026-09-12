import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { arrayBufferToBase64, pdfSplitWouldExceedBudget, MAX_CHUNK_DATA_URL } from "./fileUtils";

describe("pdfSplitWouldExceedBudget", () => {
  // Measured, not assumed: a 36 MB scan over 40 pages averages 900 kB a page,
  // which fits the budget comfortably. This pre-filter therefore does NOT
  // fire on the file that hung the page — what made that hang was the absence
  // of any yield across the whole upload, and a shared resource pool is
  // caught by the splitter's first-chunk probe instead. Asserted so nobody
  // later mistakes this check for the one carrying that case.
  test("does not fire on a 36 MB scan, whose average page fits", () => {
    assert.equal(pdfSplitWouldExceedBudget(36_000_000, 40), false);
  });

  test("fires when even the average page cannot fit", () => {
    assert.equal(pdfSplitWouldExceedBudget(200_000_000, 40), true);
  });

  test("still splits a normal text PDF", () => {
    // 2 MB over 40 pages: 50 kB a page, nowhere near the budget.
    assert.equal(pdfSplitWouldExceedBudget(2_000_000, 40), false);
  });

  test("a single heavy page is not splittable either", () => {
    assert.equal(pdfSplitWouldExceedBudget(36_000_000, 1), true);
  });

  test("accounts for base64 inflating by a third", () => {
    // Bytes that fit the budget raw, but not once encoded.
    const perPage = Math.floor(MAX_CHUNK_DATA_URL * 0.9);
    assert.equal(pdfSplitWouldExceedBudget(perPage, 1), true, "0.9 x budget raw is 1.2x encoded");
    const safe = Math.floor(MAX_CHUNK_DATA_URL * 0.7);
    assert.equal(pdfSplitWouldExceedBudget(safe, 1), false);
  });

  test("never divides by zero on an unreadable page count", () => {
    assert.equal(pdfSplitWouldExceedBudget(1000, 0), false);
  });
});

describe("arrayBufferToBase64", () => {
  // This encodes the PDF bytes that get sent for extraction, so a regression
  // here corrupts uploads rather than just slowing them down.
  const check = (size: number) => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = (i * 31 + 7) % 256;
    assert.equal(arrayBufferToBase64(bytes), Buffer.from(bytes).toString("base64"), `size ${size}`);
  };

  test("matches a reference encoder across chunk boundaries", () => {
    // 0x8000 is the internal chunk size: straddle it in both directions.
    [0, 1, 2, 3, 255, 0x7fff, 0x8000, 0x8001, 0x8000 * 2 + 5].forEach(check);
  });

  test("handles every byte value", () => {
    const all = new Uint8Array(256);
    for (let i = 0; i < 256; i++) all[i] = i;
    assert.equal(arrayBufferToBase64(all), Buffer.from(all).toString("base64"));
  });
});
