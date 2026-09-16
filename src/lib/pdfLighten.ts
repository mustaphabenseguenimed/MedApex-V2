/**
 * Turn a PDF the server cannot split into one it can.
 *
 * Extracting a single page with pdf-lib copies every resource that page
 * references, so a scan whose pages share one image pool produces per-page
 * copies nearly as large as the whole document. The in-page path already
 * handles that by re-rendering the pages as images; the background worker
 * cannot — there is no canvas on the server — and gave up with "PDF trop
 * lourd pour être découpé page par page".
 *
 * So the browser does it before the upload: each page is rendered once and
 * written back as its own JPEG page. The result splits page by page like any
 * other PDF, and the worker needs no special case.
 */

import { yieldToBrowser } from "./fileUtils";
import { pageMapFromCounts } from "./pdfSlices";

/** Per-page ceiling for the re-rendered images. Matches the in-page path, so
 *  both routes send the model pages of the same quality. */
const PAGE_MAX_BYTES = 1_200_000;

/** A4 at 72dpi — the size a page that failed to render keeps, so it still
 *  occupies its place in the document. */
const FALLBACK_PAGE = [595, 842] as const;

export type LightenProgress = (done: number, total: number) => void;

export type LightenedPdf = {
  blob: Blob;
  /** For each page of `blob`, the 0-based page of the ORIGINAL file it came
   *  from. A page cut into five slices contributes five entries. */
  pageMap: number[];
};

/**
 * Rebuild `bytes` as a PDF of rendered page slices.
 *
 * Slices, not pages: a screenshot export puts a whole clinical case on one
 * 1260x11000 page, and the model scales any image so its longest edge fits
 * ~1568 px — such a page reaches it as an unreadable strip, and it fills the
 * gaps by guessing. Cutting each page into near-square pieces keeps the text
 * at nearly its original width, and the worker then splits the result page by
 * page with no special case at all.
 *
 * The order is preserved and `pageMap` records where each piece came from, so
 * "p. 7" in the preview still means page 7 of the admin's own file. A slice
 * that fails to render becomes a blank page rather than disappearing, so the
 * map never slips out of step with the document.
 */
export async function lightenPdfToSlices(
  bytes: ArrayBuffer,
  opts?: { onProgress?: LightenProgress },
): Promise<LightenedPdf> {
  const { renderPdfPageSlices } = await import("./pdfText");
  const slices = await renderPdfPageSlices(bytes, {
    maxBytes: PAGE_MAX_BYTES,
    onProgress: opts?.onProgress,
  });
  if (!slices.length) throw new Error("Fichier vide ou illisible");

  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const perPage: number[] = [];
  for (const slice of slices) {
    perPage[slice.pageIndex] = (perPage[slice.pageIndex] ?? 0) + 1;
    if (!slice.dataUrl) {
      doc.addPage([FALLBACK_PAGE[0], FALLBACK_PAGE[1]]);
      continue;
    }
    const jpg = await doc.embedJpg(slice.dataUrl);
    const page = doc.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    // Embedding is main-thread work on a phone-sized budget; let the tab
    // breathe between slices as the renderer above already does.
    await yieldToBrowser();
  }
  const out = await doc.save();
  return {
    blob: new Blob([out as BlobPart], { type: "application/pdf" }),
    pageMap: pageMapFromCounts(Array.from(perPage, (n) => n ?? 0)),
  };
}
