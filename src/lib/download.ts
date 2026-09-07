/** Trigger a browser download of a base64-encoded file — no server storage. */
export function downloadBase64(filename: string, base64: string, mimeType: string) {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  downloadBlob(filename, new Blob([buf], { type: mimeType }));
}

/** Trigger a browser download of plain text (e.g. a generated JSON file). */
export function downloadText(filename: string, text: string, mimeType = "application/json") {
  downloadBlob(filename, new Blob([text], { type: mimeType }));
}

/** Turn a base64-encoded result back into a File, so it can be fed straight
 *  into the next step's upload without a round trip through the disk. */
export function base64ToFile(filename: string, base64: string, mimeType: string): File {
  const bytes = atob(base64);
  const buf = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new File([buf], filename, { type: mimeType });
}

/** Bundle several already-generated outputs (one per source file, in "separate
 *  results" mode) into a single .zip download. */
export async function downloadZip(
  filename: string,
  entries: { name: string; base64?: string; text?: string }[],
) {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const e of entries) {
    if (e.base64 !== undefined) zip.file(e.name, e.base64, { base64: true });
    else if (e.text !== undefined) zip.file(e.name, e.text);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(filename, blob);
}

/** Strip a file's extension — used to name a per-file output after its source
 *  (e.g. "BPCO 01.docx" -> "BPCO 01"). */
export function baseFilename(name: string): string {
  return name.replace(/\.[^./\\]+$/, "");
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
