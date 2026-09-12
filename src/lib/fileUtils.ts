export function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

/**
 * Hand the main thread back to the browser for one turn.
 *
 * Everything below runs in the page, not a worker, and a large PDF means
 * tens of seconds of solid CPU. Without a yield between units of work the
 * tab paints nothing and answers nothing — the browser reports the page as
 * unresponsive, which is indistinguishable from a crash to whoever clicked
 * the button.
 */
export function yieldToBrowser(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    // Pass the subarray straight to apply: Array.from here allocated a
    // 32k-element array per chunk, ~1100 of them for a 36 MB file, all of it
    // garbage.
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

export type PdfSplit = {
  chunks: PdfChunk[];
  /** Set when per-page copies are certain to exceed the request budget, so
   *  the caller should render the pages as images instead of splitting. */
  tooHeavyToSplit: boolean;
  totalPages: number;
};

export type PdfChunk = {
  dataUrl: string;
  label: string;
  /** How many leading pages of this chunk are context only (never extracted). */
  contextPages: number;
  /** 0-based index of the first page to actually extract from. */
  firstPageIndex: number;
  /** How many pages this chunk actually extracts from. */
  pageCount: number;
};

/**
 * Largest data URL we will put in a single request body.
 *
 * The deployment platform rejects oversized request bodies outright with a
 * plain "Request Entity Too Large" (HTTP 413) before any of our code runs, so
 * this has to be enforced here at split time. Kept well below the platform's
 * ceiling to leave room for the JSON envelope around the data URL.
 */
export const MAX_CHUNK_DATA_URL = 3_500_000;

/**
 * Split a PDF into N-page sub-PDFs (base64 data URLs) for chunked AI extraction.
 *
 * `contextPages` prepends that many preceding pages to each chunk, marked as
 * context only. A clinical-case vignette that starts on one page and whose
 * sub-questions continue on the next would otherwise be invisible to the call
 * handling the second page, orphaning those questions.
 *
 * Those context pages are dropped per-chunk when they would push the request
 * over `MAX_CHUNK_DATA_URL` — screenshot PDFs can carry several MB per page,
 * and a rejected request loses the page entirely, which is far worse than
 * losing the cross-page vignette hint for that one chunk.
 */
/**
 * Would per-page copies of this PDF certainly blow the request budget?
 *
 * A cheap pre-filter only, on the average page: base64 inflates bytes by a
 * third, so a document whose *average* page already exceeds the budget cannot
 * produce a single sendable chunk. An average is a lower bound on the real
 * per-page size, so passing here proves nothing — a shared resource pool can
 * still make one page's copy as large as the whole document, which is what
 * the splitter's first-chunk probe catches.
 */
export function pdfSplitWouldExceedBudget(byteLength: number, pageCount: number): boolean {
  return ((byteLength / Math.max(1, pageCount)) * 4) / 3 > MAX_CHUNK_DATA_URL;
}

export async function splitPdfIntoPageChunks(
  bytes: ArrayBuffer,
  pagesPerChunk = 3,
  contextPages = 0,
  opts?: { onProgress?: (done: number, total: number) => void },
): Promise<PdfSplit> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes);
  const totalPages = src.getPageCount();

  if (pdfSplitWouldExceedBudget(bytes.byteLength, totalPages)) {
    return { chunks: [], tooHeavyToSplit: true, totalPages };
  }

  const chunkCount = Math.max(1, Math.ceil(totalPages / pagesPerChunk));
  const out: PdfChunk[] = [];

  const build = async (from: number, to: number): Promise<string> => {
    const indices = Array.from({ length: to - from }, (_, k) => from + k);
    const sub = await PDFDocument.create();
    const copied = await sub.copyPages(src, indices);
    copied.forEach((p) => sub.addPage(p));
    const subBytes = await sub.save();
    return `data:application/pdf;base64,${arrayBufferToBase64(subBytes)}`;
  };

  for (let ci = 0; ci < chunkCount; ci++) {
    const start = ci * pagesPerChunk;
    const end = Math.min(start + pagesPerChunk, totalPages);
    const ctxStart = Math.max(0, start - contextPages);

    let from = ctxStart;
    let dataUrl = await build(from, end);
    if (from < start && dataUrl.length > MAX_CHUNK_DATA_URL) {
      // Too heavy with context — fall back to the target pages alone.
      from = start;
      dataUrl = await build(from, end);
    }

    // Copying one page drags in every resource it references. When the very
    // first copy comes out over budget AND carrying most of the document, the
    // pages share one resource pool and every remaining copy will be just as
    // large — 40 pages of that is tens of MB of base64 built and thrown away.
    // The caller re-renders such a document as images anyway, so stop here
    // rather than doing the other 39.
    if (ci === 0 && dataUrl.length > MAX_CHUNK_DATA_URL) {
      const encodedWhole = (bytes.byteLength * 4) / 3;
      if (dataUrl.length > encodedWhole * 0.5) {
        return { chunks: [], tooHeavyToSplit: true, totalPages };
      }
    }

    out.push({
      dataUrl,
      label: `p${start + 1}-${end}`,
      contextPages: start - from,
      firstPageIndex: start,
      pageCount: end - start,
    });
    opts?.onProgress?.(ci + 1, chunkCount);
    await yieldToBrowser();
  }
  return { chunks: out, tooHeavyToSplit: false, totalPages };
}
