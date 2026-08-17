/**
 * Normalize imported HTML so text uses the app's default theme foreground.
 *
 * Import rule (updated):
 *   • Preserve the source document's colors AND highlights so that whatever
 *     the author chose in Word/PDF is what the student sees.
 *   • On display, additionally colorize the literal French words "vrai"
 *     (green) and "faux" (red) — case-insensitive — as a safety net for
 *     sources that did not color them.
 *   • Only strip Word `mso-*` noise from styles (harmless cleanup).
 */

const VRAI_COLOR = "#16a34a"; // green‑600
const FAUX_COLOR = "#dc2626"; // red‑600

/**
 * Kept for backward compatibility with pre-existing call sites in the
 * import pipeline. Always returns false — the pipeline no longer decides
 * per-color; it strips every color unconditionally.
 */
export function isUnreadableOnDark(_value: string): boolean {
  return false;
}

/** Remove only `mso-*` noise from a style attribute; keep colors + highlights. */
function stripStyle(style: string): string {
  const kept = style
    .split(";")
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => {
      const i = d.indexOf(":");
      if (i === -1) return null;
      const prop = d.slice(0, i).trim().toLowerCase();
      return { prop, decl: d };
    })
    .filter((x): x is { prop: string; decl: string } => x !== null)
    .filter(({ prop }) => !prop.startsWith("mso-"))
    .map(({ decl }) => decl);
  return kept.join("; ");
}

/** Cleanup `mso-*` noise only — preserves author colors and highlights. */
export function stripImportedColors(html: string): string {
  if (!html) return html;
  const out = html.replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_full, quote: string, style: string) => {
    const next = stripStyle(style);
    return next ? ` style=${quote}${next}${quote}` : "";
  });
  return out;
}

/**
 * Remove bold emphasis from imported content (used for question stems and
 * choices): drops <strong>/<b> wrappers and any font-weight declarations.
 */
export function stripBold(html: string): string {
  if (!html) return html;
  return html
    .replace(/<\/?(?:strong|b)\b[^>]*>/gi, "")
    .replace(/\sstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_full, quote: string, style: string) => {
      const next = style
        .split(";")
        .filter((d) => !/^\s*font-weight\s*:/i.test(d))
        .join(";")
        .replace(/^;+|;+$/g, "")
        .trim();
      return next ? ` style=${quote}${next}${quote}` : "";
    });
}

// Word-boundaries that also count French apostrophes / punctuation as boundaries.
const VRAI = /(^|[\s\p{P}>])(vrai|vraie|vrais|vraies)($|[\s\p{P}<])/giu;
const FAUX = /(^|[\s\p{P}>])(faux|fausse|fausses)($|[\s\p{P}<])/giu;
// Option letters: "A)", "b.", "C -", "(D)" … only A–E, followed by a separator.
const LETTER = /(^|[\s(>])([A-Ea-e])(\s*[).:\-–—])/gu;

/** Block-level tags that delimit one per-option explanation line. */
const BLOCK_TAG =
  /<\/?(?:p|li|div|br|hr|tr|td|th|h[1-6]|blockquote|ul|ol|table|tbody|thead|section|article)\b[^>]*>/gi;

function textOnly(chunk: string): string {
  return chunk.replace(/<[^>]*>/g, " ");
}

/** Which verdict (if any) this line carries — whichever word appears first. */
function verdictColor(chunk: string): string | null {
  const text = textOnly(chunk);
  VRAI.lastIndex = 0;
  FAUX.lastIndex = 0;
  const v = VRAI.exec(text);
  const f = FAUX.exec(text);
  if (v && f) return v.index <= f.index ? VRAI_COLOR : FAUX_COLOR;
  if (v) return VRAI_COLOR;
  if (f) return FAUX_COLOR;
  return null;
}

/**
 * Colorize one block-level chunk: "vrai" green, "faux" red, and the option
 * letter (a/b/c/d/e) in the same color as that line's verdict.
 */
function colorizeChunk(chunk: string): string {
  const letterColor = verdictColor(chunk);
  // Lines whose option letter was already colored at import time (JSON) keep it.
  const hasPreColoredLetter = /data-vf=["']letter["']/.test(chunk);
  return transformTextSegments(chunk, (text) => {
    let out = text
      .replace(VRAI, (_m, p1: string, w: string, p3: string) =>
        `${p1}<span style="color:${VRAI_COLOR};font-weight:600">${w}</span>${p3}`,
      )
      .replace(FAUX, (_m, p1: string, w: string, p3: string) =>
        `${p1}<span style="color:${FAUX_COLOR};font-weight:600">${w}</span>${p3}`,
      );
    if (letterColor && !hasPreColoredLetter) {
      out = out.replace(LETTER, (_m, p1: string, l: string, p3: string) =>
        `${p1}<span style="color:${letterColor};font-weight:700">${l}${p3}</span>`,
      );
    }
    return out;
  });
}

/**
 * Wrap standalone "vrai"/"faux" in colored spans and match each option letter
 * to its own line's verdict (a. vrai → both green; b. faux → both red).
 */
export function applyVraiFauxColors(html: string): string {
  if (!html) return html;
  let out = "";
  let i = 0;
  let m: RegExpExecArray | null;
  BLOCK_TAG.lastIndex = 0;
  while ((m = BLOCK_TAG.exec(html)) !== null) {
    out += colorizeChunk(html.slice(i, m.index)) + m[0];
    i = BLOCK_TAG.lastIndex;
  }
  return highlightARetenir(out + colorizeChunk(html.slice(i)));
}

/**
 * Highlight the trailing "à retenir" section of an explanation: the phrase
 * itself becomes bold, and it plus everything after it turns red text on a
 * yellow highlight. Matches "à retenir", "a retenir", "à retenir :", etc.,
 * case-insensitive. Only the first (outermost) occurrence is wrapped.
 */
function highlightARetenir(html: string): string {
  if (!html) return html;
  // Find the first "à/a retenir" that lives in text (not inside a tag).
  const re = /(?<![>\w])([àaÀA]\s*retenir)/i;
  // Walk text segments to locate a hit outside of tags.
  const tagRe = /<[^>]*>/g;
  let cursor = 0;
  let hitAbs = -1;
  let hitLen = 0;
  let t: RegExpExecArray | null;
  const scan = (from: number, to: number): boolean => {
    const slice = html.slice(from, to);
    const m = re.exec(slice);
    if (!m) return false;
    hitAbs = from + m.index;
    hitLen = m[1].length;
    return true;
  };
  while ((t = tagRe.exec(html)) !== null) {
    if (scan(cursor, t.index)) break;
    cursor = tagRe.lastIndex;
  }
  if (hitAbs === -1) scan(cursor, html.length);
  if (hitAbs === -1) return html;
  const before = html.slice(0, hitAbs);
  const phrase = html.slice(hitAbs, hitAbs + hitLen);
  let after = html.slice(hitAbs + hitLen);
  let rest = "";
  // Stop the highlight before the next option line (pre-colored letter), so a
  // "à retenir" inside one option never bleeds into the following options.
  const nextOption = after.search(/<p[^>]*>\s*<span[^>]*data-vf=["']letter["']/i);
  if (nextOption >= 0) {
    rest = after.slice(nextOption);
    after = after.slice(0, nextOption);
  }
  const wrapped =
    `<span style="color:#dc2626;background-color:#fef08a">` +
    `<strong>${phrase}</strong>${after}` +
    `</span>`;
  return before + wrapped + rest;
}

/**
 * Walk `html` and apply `fn` only to text between tags, skipping the contents
 * of <script>, <style>, <code> and <pre>. Tag-aware so attribute values are
 * never touched.
 */
function transformTextSegments(html: string, fn: (text: string) => string): string {
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  const skip = new Set(["script", "style", "code", "pre"]);
  let out = "";
  let i = 0;
  let skipDepth = 0;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const text = html.slice(i, m.index);
    out += skipDepth > 0 ? text : fn(text);
    out += m[0];
    const tag = m[1].toLowerCase();
    const isClose = m[0].startsWith("</");
    const isSelfClose = m[0].endsWith("/>");
    if (skip.has(tag) && !isSelfClose) {
      if (isClose) skipDepth = Math.max(0, skipDepth - 1);
      else skipDepth += 1;
    }
    i = tagRe.lastIndex;
  }
  const tail = html.slice(i);
  out += skipDepth > 0 ? tail : fn(tail);
  return out;
}

/** Full import-time normalization for explanations: clean styles, then colorize. */
export function normalizeImportedHtml(html: string): string {
  return applyVraiFauxColors(stripImportedColors(html));
}

/** Back-compat alias — existing call sites keep working. */
export const normalizeInlineTextColors = normalizeImportedHtml;
