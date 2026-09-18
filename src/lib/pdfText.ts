/**
 * Client-side PDF text extraction (pdf.js).
 *
 * Text-based PDFs are converted to plain text so the importer can use the fast
 * text pipeline instead of re-uploading PDF binary per chunk. Pages with no
 * extractable text (scans/photos) are reported so the caller can fall back to
 * sending those pages as images/PDF to the AI.
 */

import { yieldToBrowser } from "./fileUtils";
import { contentRenderScale, PAGE_QUALITY_LADDER, sliceRanges, stripsFitBudget } from "./pdfSlices";

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
 *  part it is about to throw away — the canvas clips it instead. `top` slides
 *  that window down the page, which is how one slice is rasterised without
 *  ever holding a bitmap of the whole page. */
async function renderPageToCanvas(
  page: any,
  scale: number,
  crop?: { left?: number; top?: number; width?: number; height?: number },
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const left = Math.max(0, Math.floor(crop?.left ?? 0));
  const top = Math.max(0, Math.floor(crop?.top ?? 0));
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(Math.ceil(viewport.width) - left, crop?.width ?? Infinity);
  canvas.height = Math.min(Math.ceil(viewport.height) - top, crop?.height ?? Infinity);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas non supporté par ce navigateur");
  // JPEG has no alpha: paint white first or transparent areas come out black.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Shift the page so the wanted window lands in the canvas; everything
  // outside it is clipped by the canvas bounds rather than drawn. This is what
  // lets a slice be rasterised at a high scale without ever allocating a
  // bitmap of the whole page at that scale.
  if (left || top) ctx.translate(-left, -top);
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

/**
 * The rectangle of a page that actually carries ink, in page units.
 *
 * A screenshot export can place its capture as a narrow column on an A4 page —
 * the Sarcoïdose PDF draws a 1260 px wide screenshot into a strip 100 pt wide
 * with white margins either side. Rendering such a page at a fixed scale hands
 * the model text at a sixth of its original width, which it cannot read and
 * fills in by guessing. Finding the ink first means the render scale can be
 * chosen from the content rather than from the paper it was dropped onto.
 *
 * Probed cheaply at low resolution; a page that reads as blank (or that cannot
 * be probed at all) reports its full box, so the caller simply behaves as
 * before.
 */
async function inkBounds(
  page: Parameters<typeof renderPageToCanvas>[0],
): Promise<{ left: number; top: number; width: number; height: number }> {
  const full = page.getViewport({ scale: 1 });
  const whole = { left: 0, top: 0, width: full.width, height: full.height };
  try {
    const probe = 1.5;
    const canvas = await renderPageToCanvas(page, probe);
    const ctx = canvas.getContext("2d");
    if (!ctx) return whole;
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        // Anything clearly off-white counts as content. Generous, because
        // cutting off a grey heading costs more than a few extra pixels.
        if (data[i] > 245 && data[i + 1] > 245 && data[i + 2] > 245) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return whole;
    // A small margin so nothing sits flush against the edge.
    const pad = 4 * probe;
    const left = Math.max(0, minX - pad) / probe;
    const top = Math.max(0, minY - pad) / probe;
    return {
      left,
      top,
      width: Math.min(full.width, (maxX + pad) / probe) - left,
      height: Math.min(full.height, (maxY + pad) / probe) - top,
    };
  } catch {
    // getImageData can throw on a tainted or oversized canvas; the full page
    // is always a safe answer.
    return whole;
  }
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
    const canvas = await renderPageToCanvas(page, scale, { height: cropHeight });
    images.push(canvas.toDataURL("image/jpeg", 0.9));
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return images;
}

/** One rendered slice of a page. */
export type PageSlice = {
  /** 0-based page of the source PDF this slice was cut from. */
  pageIndex: number;
  /** Position of this slice among its page's slices, 0-based. */
  sliceIndex: number;
  /** How many slices that page produced. */
  sliceCount: number;
  dataUrl: string;
};

/**
 * Render every page as one or more JPEG slices, each shaped so the text
 * survives the model's own downscale.
 *
 * Same size ladder as `renderPdfPages`, applied per slice. A page already
 * within the aspect budget yields exactly one slice covering it, so an
 * ordinary document produces exactly what it did before.
 */
export async function renderPdfPageSlices(
  bytes: ArrayBuffer,
  opts?: {
    /** Ceiling for ALL of one page's strips together. A page now travels as a
     *  single request, so what has to fit is the page, not the strip. */
    maxPageBytes?: number;
    maxAspect?: number;
    /** Width, in pixels, the page's content should reach. */
    targetWidth?: number;
    /** Only these pages (0-based). Omitted means every page. Used to re-render
     *  one page that came back empty, harder, without redoing the file. */
    pages?: number[];
    onProgress?: (done: number, total: number) => void;
  },
): Promise<PageSlice[]> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
  const maxPageBytes = opts?.maxPageBytes ?? 3_000_000;
  const out: PageSlice[] = [];

  const wanted = opts?.pages ? new Set(opts.pages) : null;
  const total = wanted ? wanted.size : doc.numPages;
  let done = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    if (wanted && !wanted.has(i - 1)) continue;
    const page = await doc.getPage(i);
    // Scale from the CONTENT, not the paper. A page that carries its capture
    // in a 100 pt strip on an A4 sheet renders, at any fixed scale, as text a
    // sixth of its original width — unreadable, and the model invents rather
    // than reports. Cropping to the ink and scaling that to a legible width
    // is what makes the rest of this worth doing.
    const ink = await inkBounds(page);
    // The probe rasterises and reads back a whole page; give the tab a turn
    // before starting on the slices.
    await yieldToBrowser();
    const scale = contentRenderScale(ink.width, opts?.targetWidth);
    // Now cut the (often very tall) content, in rendered pixels.
    const ranges = sliceRanges(ink.width * scale, ink.height * scale, {
      maxAspect: opts?.maxAspect,
    });

    // Render the page's strips at one setting, and step that setting down
    // until the WHOLE page fits its budget. Quality first, then scale:
    // shrinking is what costs legibility, and legibility is the point. The
    // cuts never move — those are geometry; only the quality gives way — so
    // a page always comes back with the same number of strips.
    let strips: string[] = [];
    for (const { factor, quality } of PAGE_QUALITY_LADDER) {
      strips = [];
      for (const range of ranges) {
        const canvas = await renderPageToCanvas(page, scale * factor, {
          left: Math.floor(ink.left * scale * factor),
          top: Math.floor((ink.top * scale + range.top) * factor),
          width: Math.ceil(ink.width * scale * factor),
          height: Math.ceil(range.height * factor),
        });
        strips.push(canvas.toDataURL("image/jpeg", quality));
        // Rendering and JPEG-encoding is solid main-thread CPU; without this
        // the tab is unresponsive for the whole document.
        await yieldToBrowser();
      }
      if (stripsFitBudget(strips, maxPageBytes)) break;
    }
    strips.forEach((dataUrl, s) =>
      out.push({ pageIndex: i - 1, sliceIndex: s, sliceCount: ranges.length, dataUrl }),
    );
    opts?.onProgress?.(++done, total);
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return out;
}
