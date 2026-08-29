/**
 * Client-side PDF text extraction (pdf.js).
 *
 * Text-based PDFs are converted to plain text so the importer can use the fast
 * text pipeline instead of re-uploading PDF binary per chunk. Pages with no
 * extractable text (scans/photos) are reported so the caller can fall back to
 * sending those pages as images/PDF to the AI.
 */

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
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas non supporté par ce navigateur");
    await page.render({ canvasContext: ctx, viewport }).promise;

    const cropHeight = Math.max(1, Math.round(canvas.height * cropTop));
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = canvas.width;
    cropCanvas.height = cropHeight;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) throw new Error("Canvas non supporté par ce navigateur");
    cropCtx.drawImage(canvas, 0, 0, canvas.width, cropHeight, 0, 0, canvas.width, cropHeight);
    images.push(cropCanvas.toDataURL("image/png"));
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }
  return images;
}
