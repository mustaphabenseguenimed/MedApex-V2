export function readAsDataUrl(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });
}

export function arrayBufferToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(binary);
}

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
export async function splitPdfIntoPageChunks(
  bytes: ArrayBuffer,
  pagesPerChunk = 3,
  contextPages = 0,
): Promise<PdfChunk[]> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes);
  const totalPages = src.getPageCount();
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

    out.push({
      dataUrl,
      label: `p${start + 1}-${end}`,
      contextPages: start - from,
      firstPageIndex: start,
      pageCount: end - start,
    });
  }
  return out;
}
