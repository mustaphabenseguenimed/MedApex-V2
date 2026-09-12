/**
 * Client-side PDF text extraction (pdf.js).
 *
 * Text-based PDFs are converted to plain text so the importer can use the fast
 * text pipeline instead of re-uploading PDF binary per chunk. Pages with no
 * extractable text (scans/photos) are reported so the caller can fall back to
 * sending those pages as images/PDF to the AI.
 */

import { yieldToBrowser } from "./fileUtils";

export type PdfTextResult = {
  /** Extracted text, page by page (empty string for scanned pages). */
  pages: string[];
  /** 0-based indexes of pages with no usable text layer. */
  scannedPages: number[];
  totalPages: number;
};

/** Below this many characters a page is considered "no text layer". */
const MIN_CHARS_PER_PAGE = 40;

async function getPdfjs() {
  const pdfjs: any = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

export async function extractPdfText(file: File | ArrayBuffer): Promise<PdfTextResult> {
  const pdfjs = await getPdfjs();
  const data = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const pages: string[] = [];
  const scannedPages: number[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Rebuild lines from item positions so "A." options stay on their own line.
    let lastY: number | null = null;
    let line = "";
    const lines: string[] = [];
    for (const item of content.items as any[]) {
      const str: string = item.str ?? "";
      const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      line += str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
      if (y !== null) lastY = y;
    }
    if (line.trim()) lines.push(line.trim());

    const text = lines.join("\n");
    pages.push(text);
    if (text.replace(/\s/g, "").length < MIN_CHARS_PER_PAGE) scannedPages.push(i - 1);
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return { pages, scannedPages, totalPages: doc.numPages };
}

/** Render one already-loaded pdf.js page to a canvas at `scale`.
 *
 *  `maxHeight` caps the canvas height, so a caller that only wants the top of
 *  the page neither allocates a full-page bitmap nor pays to rasterise the
 *  part it is about to throw away — the canvas clips it instead. */
async function renderPageToCanvas(
  page: any,
  scale: number,
  maxHeight?: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.min(Math.ceil(viewport.height), maxHeight ?? Infinity);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non supporté par ce navigateur");
  // JPEG has no alpha: paint white first or transparent areas come out black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * Render every page as a JPEG data URL that fits within `maxBytes`.
 *
 * Used instead of shipping the PDF bytes themselves when a page's sub-PDF
 * would be too large to send. Extracting one page with pdf-lib copies every
 * resource that page references, so for a PDF that shares an image pool
 * across pages (how screenshot exports are typically built) a single-page
 * copy can be nearly the size of the whole document — regardless of what is
 * actually on that page. Re-rendering sidesteps that completely: the payload
 * depends only on the settings chosen here, so an arbitrarily large source
 * PDF still produces a request that fits.
 *
 * Quality is stepped down first (cheap, barely visible on text), then scale,
 * until the encoded size fits. The last attempt is returned even if it is
 * still over budget, so the caller can decide what to do about that page.
 */
export async function renderPdfPages(
  bytes: ArrayBuffer,
  opts?: {
    scale?: number;
    maxBytes?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<string[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const baseScale = opts?.scale ?? 2;
  const maxBytes = opts?.maxBytes ?? 1_500_000;
  const images: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    let out = "";
    // Text stays legible well below full quality, so try quality first and
    // only shrink the raster if that is not enough.
    outer: for (const scale of [baseScale, baseScale * 0.75, baseScale * 0.5]) {
      const canvas = await renderPageToCanvas(page, scale);
      for (const quality of [0.85, 0.7, 0.55]) {
        out = canvas.toDataURL("image/jpeg", quality);
        if (out.length <= maxBytes) break outer;
      }
    }
    images.push(out);
    opts?.onProgress?.(i, doc.numPages);
    // Rendering and JPEG-encoding a page is solid main-thread CPU; without
    // this the tab is unresponsive for the whole document.
    await yieldToBrowser();
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return images;
}

/**
 * Render just the top strip of each page as a high-resolution PNG data URL —
 * used to read a small header (e.g. a rotation/année banner) reliably: a
 * whole-page render/downsample by the AI provider makes small header text
 * illegible, but cropping to the top fraction before sending gives the model
 * a much larger effective view of the same text.
 */
export async function renderPdfPageTopImages(
  bytes: ArrayBuffer,
  opts?: { scale?: number; cropTop?: number },
): Promise<string[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const scale = opts?.scale ?? 2.5;
  const cropTop = opts?.cropTop ?? 0.18;
  const images: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    // Only the top strip is ever used, so render only the top strip: the old
    // path rasterised the whole page at full scale and then threw ~80% of it
    // away, which on a long captures PDF is most of the wait before the first
    // request even goes out. JPEG rather than PNG for the same reason —
    // encoding is far cheaper and the payload much smaller, at a quality
    // where header text is still crisp.
    const cropHeight = Math.max(1, Math.round(page.getViewport({ scale }).height * cropTop));
    const canvas = await renderPageToCanvas(page, scale, cropHeight);
    images.push(canvas.toDataURL("image/jpeg", 0.9));
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return images;
}
