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
 * Split a PDF into N-page sub-PDFs (base64 data URLs) for chunked AI extraction.
 *
 * `contextPages` prepends that many preceding pages to each chunk, marked as
 * context only. A clinical-case vignette that starts on one page and whose
 * sub-questions continue on the next would otherwise be invisible to the call
 * handling the second page, orphaning those questions.
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
  for (let ci = 0; ci < chunkCount; ci++) {
    const start = ci * pagesPerChunk;
    const end = Math.min(start + pagesPerChunk, totalPages);
    const ctxStart = Math.max(0, start - contextPages);
    const indices = Array.from({ length: end - ctxStart }, (_, k) => ctxStart + k);
    const sub = await PDFDocument.create();
    const copied = await sub.copyPages(src, indices);
    copied.forEach((p) => sub.addPage(p));
    const subBytes = await sub.save();
    out.push({
      dataUrl: `data:application/pdf;base64,${arrayBufferToBase64(subBytes)}`,
      label: `p${start + 1}-${end}`,
      contextPages: start - ctxStart,
      firstPageIndex: start,
      pageCount: end - start,
    });
  }
  return out;
}
