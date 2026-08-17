/**
 * Credit-free extraction of a course list ("programme") from a file.
 * Works fully in the browser: PDF text layer, DOCX text, image OCR.
 * The AI gateway is only used as a last resort by the caller.
 */

const NOISE = [
  /^sommaire$/i,
  /^table des mati/i,
  /^objectifs?( g[ée]n[ée]raux)?$/i,
  /^bibliographie$/i,
  /^r[ée]f[ée]rences?$/i,
  /^programme( officiel)?$/i,
  /^plan$/i,
  /^introduction$/i,
  /^page\s*\d+/i,
  /^ann[ée]e\s+universitaire/i,
  /^universit[ée]/i,
  /^facult[ée]/i,
  /^minist[èe]re/i,
  /^module\b/i,
  /^total\b/i,
  /^\d+\s*(h|heures?)$/i,
];

const BULLET = /^\s*(?:[-–—*•▪◦]|\(?\d{1,3}\)?[.)]|[ivxlcdm]{1,6}[.)]|[a-z][.)])\s+/i;

function cleanLine(raw: string): string {
  return raw
    .replace(/\u00a0/g, " ")
    .replace(BULLET, "")
    .replace(/\.{3,}\s*\d*\s*$/, "") // dot leaders from a table of contents
    .replace(/\s{2,}\d{1,3}\s*$/, "") // trailing page number
    .replace(/\s+/g, " ")
    .trim();
}

function isNoise(line: string): boolean {
  if (NOISE.some((re) => re.test(line))) return true;
  if (!/[a-zà-ÿ]/i.test(line)) return true; // no letters at all
  const letters = line.replace(/[^a-zà-ÿ]/gi, "").length;
  return letters < 3;
}

/** Turn raw program text into an ordered, de-duplicated list of course titles. */
export function parseProgramText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = cleanLine(rawLine);
    if (!line || line.length > 200) continue;
    if (isNoise(line)) continue;
    // Drop sentences / paragraphs: course titles are short label-like lines.
    const words = line.split(/\s+/).length;
    if (words > 18) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** OCR one or more images in the browser (no API key, no credits). */
export async function ocrImages(
  files: File[],
  onProgress?: (done: number, total: number) => void,
): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["fra", "eng"]);
  try {
    const texts: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const { data } = await worker.recognize(files[i]);
      texts.push(data.text ?? "");
      onProgress?.(i + 1, files.length);
    }
    return texts.join("\n");
  } finally {
    await worker.terminate();
  }
}

/** Extract plain text from a DOCX file in the browser. */
export async function docxToText(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return String(result?.value ?? "");
}
