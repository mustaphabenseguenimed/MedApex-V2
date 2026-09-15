import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  arrayBufferToBase64,
  pdfSplitWouldExceedBudget,
  splitPdfIntoPageChunks,
  MAX_CHUNK_DATA_URL,
  MAX_SERVER_CHUNK,
} from "./fileUtils";

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

describe("splitPdfIntoPageChunks probe", () => {
  /** A small multi-page PDF, built the same way the app builds its own. */
  const samplePdf = async (pages: number): Promise<ArrayBuffer> => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
    const bytes = await doc.save();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };

  // The point of the probe: the page that uploads to the background worker
  // needs the verdict, not the chunks, and building forty page copies of a
  // heavy scan to learn it is exactly what it is avoiding.
  test("stops after one chunk but still reports the page count", async () => {
    const bytes = await samplePdf(6);
    const probe = await splitPdfIntoPageChunks(bytes, 1, 1, {
      maxDataUrl: MAX_SERVER_CHUNK,
      probeOnly: true,
    });
    assert.equal(probe.totalPages, 6);
    assert.equal(probe.chunks.length, 1);
    assert.equal(probe.tooHeavyToSplit, false);
  });

  test("a full split still returns every page", async () => {
    const bytes = await samplePdf(6);
    const split = await splitPdfIntoPageChunks(bytes, 1, 1, { maxDataUrl: MAX_SERVER_CHUNK });
    assert.equal(split.chunks.length, 6);
    assert.deepEqual(
      split.chunks.map((c) => c.firstPageIndex),
      [0, 1, 2, 3, 4, 5],
    );
  });

  // A budget no page can meet is refused before any copy is built, so the
  // probe answers "too heavy" without the work it exists to avoid.
  test("an impossible budget is refused outright", async () => {
    const bytes = await samplePdf(4);
    const probe = await splitPdfIntoPageChunks(bytes, 1, 1, {
      maxDataUrl: 10,
      probeOnly: true,
    });
    assert.equal(probe.tooHeavyToSplit, true);
    assert.deepEqual(probe.chunks, []);
    assert.equal(probe.totalPages, 4);
  });
});
