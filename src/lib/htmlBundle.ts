// Client-side helpers for parsing HTML course ZIP bundles.
import JSZip from "jszip";

export type BundleEntry = { path: string; blob: Blob; contentType: string };
export type ParsedBundle = {
  entries: BundleEntry[];
  htmlPaths: string[];    // all .html paths, sorted (shallowest first)
  suggestedEntry: string; // relative to bundle root
  totalBytes: number;
  skipped: string[];      // entries dropped for safety (traversal, junk)
};

const MIME: Record<string, string> = {
  html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "application/javascript; charset=utf-8", mjs: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8", map: "application/json; charset=utf-8",
  svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
  txt: "text/plain; charset=utf-8", pdf: "application/pdf",
  mp4: "video/mp4", webm: "video/webm", mp3: "audio/mpeg", wav: "audio/wav",
};
export function contentTypeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export function sanitizeSegment(seg: string): string {
  return seg.replace(/[^A-Za-z0-9._-]+/g, "_");
}
export function sanitizeRelPath(p: string): string | null {
  // Reject traversal, absolute, backslash, null. Sanitize each segment.
  if (!p || p.includes("\0") || p.startsWith("/") || p.includes("\\")) return null;
  const out: string[] = [];
  for (const raw of p.split("/")) {
    if (!raw || raw === ".") continue;
    if (raw === "..") return null;
    out.push(sanitizeSegment(raw));
  }
  return out.length ? out.join("/") : null;
}

function isJunk(p: string): boolean {
  if (p.startsWith("__MACOSX/") || p.includes("/__MACOSX/")) return true;
  const base = p.split("/").pop() ?? "";
  if (base === ".DS_Store" || base === "Thumbs.db" || base.startsWith("._")) return true;
  return false;
}

function pickEntry(htmlPaths: string[]): string {
  if (htmlPaths.length === 0) return "";
  const idx = htmlPaths.find(p => p.toLowerCase().endsWith("/index.html") || p.toLowerCase() === "index.html");
  if (idx) return idx;
  return [...htmlPaths].sort((a, b) => a.split("/").length - b.split("/").length || a.length - b.length)[0];
}

function commonWrapper(paths: string[]): string {
  // If every path shares the same first segment, return it (to strip).
  if (paths.length < 2) return "";
  const first = paths[0].split("/")[0];
  if (!first || !paths[0].includes("/")) return "";
  for (const p of paths) {
    const seg = p.split("/")[0];
    if (seg !== first || !p.includes("/")) return "";
  }
  return first;
}

export async function parseBundle(file: File): Promise<ParsedBundle> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm")) {
    const rel = "index.html";
    return {
      entries: [{ path: rel, blob: file, contentType: "text/html; charset=utf-8" }],
      htmlPaths: [rel], suggestedEntry: rel, totalBytes: file.size, skipped: [],
    };
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const raw: { path: string; entry: JSZip.JSZipObject }[] = [];
  const skipped: string[] = [];
  zip.forEach((path, entry) => {
    if (entry.dir) return;
    if (isJunk(path)) { skipped.push(path); return; }
    raw.push({ path, entry });
  });
  if (raw.length === 0) throw new Error("Archive vide");

  // Strip common wrapper folder if any.
  const wrapper = commonWrapper(raw.map(r => r.path));
  const stripped = wrapper
    ? raw.map(r => ({ ...r, path: r.path.slice(wrapper.length + 1) }))
    : raw;

  const seen = new Set<string>();
  const entries: BundleEntry[] = [];
  let totalBytes = 0;
  for (const { path, entry } of stripped) {
    const safe = sanitizeRelPath(path);
    if (!safe) { skipped.push(path); continue; }
    if (seen.has(safe)) { skipped.push(path + " (doublon)"); continue; }
    seen.add(safe);
    const blob = await entry.async("blob");
    totalBytes += blob.size;
    entries.push({ path: safe, blob, contentType: contentTypeFor(safe) });
  }

  const htmlPaths = entries.map(e => e.path).filter(p => /\.(html?|htm)$/i.test(p));
  if (htmlPaths.length === 0) throw new Error("Aucun fichier HTML trouvé dans l'archive");
  const suggestedEntry = pickEntry(htmlPaths);

  return { entries, htmlPaths, suggestedEntry, totalBytes, skipped };
}

export function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}