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

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
