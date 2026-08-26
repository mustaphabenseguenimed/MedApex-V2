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

/** Split a PDF into N-page sub-PDFs (base64 data URLs) for chunked AI extraction. */
export async function splitPdfIntoPageChunks(
  bytes: ArrayBuffer,
  pagesPerChunk = 3,
): Promise<{ dataUrl: string; label: string }[]> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(bytes);
  const totalPages = src.getPageCount();
  const chunkCount = Math.max(1, Math.ceil(totalPages / pagesPerChunk));
  const out: { dataUrl: string; label: string }[] = [];
  for (let ci = 0; ci < chunkCount; ci++) {
    const start = ci * pagesPerChunk;
    const end = Math.min(start + pagesPerChunk, totalPages);
    const indices = Array.from({ length: end - start }, (_, k) => start + k);
    const sub = await PDFDocument.create();
    const copied = await sub.copyPages(src, indices);
    copied.forEach((p) => sub.addPage(p));
    const subBytes = await sub.save();
    out.push({
      dataUrl: `data:application/pdf;base64,${arrayBufferToBase64(subBytes)}`,
      label: `p${start + 1}-${end}`,
    });
  }
  return out;
}
