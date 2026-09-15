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

/** Per-page ceiling for the re-rendered images. Matches the in-page path, so
 *  both routes send the model pages of the same quality. */
const PAGE_MAX_BYTES = 1_200_000;

/** A4 at 72dpi — the size a page that failed to render keeps, so it still
 *  occupies its place in the document. */
const FALLBACK_PAGE = [595, 842] as const;

export type LightenProgress = (done: number, total: number) => void;

/**
 * Rebuild `bytes` as a PDF of rendered page images.
 *
 * Page count and page order are preserved exactly — a page that fails to
 * render becomes a blank page rather than disappearing, because every page
 * number the admin reads afterwards ("p. 7") counts pages of this file.
 */
export async function lightenPdfToImages(
  bytes: ArrayBuffer,
  opts?: { onProgress?: LightenProgress },
): Promise<Blob> {
  const { renderPdfPages } = await import("./pdfText");
  const images = await renderPdfPages(bytes, {
    maxBytes: PAGE_MAX_BYTES,
    onProgress: opts?.onProgress,
  });
  if (!images.length) throw new Error("Fichier vide ou illisible");

  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  for (const dataUrl of images) {
    if (!dataUrl) {
      doc.addPage([FALLBACK_PAGE[0], FALLBACK_PAGE[1]]);
      continue;
    }
    const jpg = await doc.embedJpg(dataUrl);
    const page = doc.addPage([jpg.width, jpg.height]);
    page.drawImage(jpg, { x: 0, y: 0, width: jpg.width, height: jpg.height });
    // Embedding is main-thread work on a phone-sized budget; let the tab
    // breathe between pages as the renderer above already does.
    await yieldToBrowser();
  }
  const out = await doc.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}
