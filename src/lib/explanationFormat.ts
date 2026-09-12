/**
 * Shared formatting for a question's explanation.
 *
 * Step 2 writes per-proposition explanations as a numbered HTML list, the
 * .docx writer turns each item into its own line inside a single paragraph
 * (soft breaks — see `linesParagraph` in questionsDocxBuilder.ts), and Step 3
 * reads that document back. Everything here exists so the reader sees the same
 * one-item-per-line layout at every stage of that round trip.
 *
 * Kept free of server-only imports so it can be bundled and unit-tested on its
 * own, like answerVerdicts.ts and referenceDocs.ts.
 */

/** Split light HTML into the lines it was meant to be read as, keeping inline
 *  markup (<strong>, <em>, <img>…) inside each line. */
export function explanationLines(html: string): string[] {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<(?:p|div|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        !!line &&
        !!line
          .replace(/<[^>]+>/g, "")
          .replace(/&nbsp;/g, " ")
          .trim(),
    );
}

/** Markers like "A.", "A)", "A -", "A:" or "1.", "2)" … at start-of-string or
 *  right after whitespace/a tag. Letters stop at H and numbers at 8: an
 *  explanation never ventilates more propositions than a question has. */
const MARKER_RE = /(?:^|(?<=>|\s|\u00a0))([A-Ha-h]|[1-8])\s*[.)\-:]\s+/g;

type Marker = { idx: number; label: string; rank: number; end: number };

function markersOf(inner: string): Marker[] {
  const out: Marker[] = [];
  let m: RegExpExecArray | null;
  MARKER_RE.lastIndex = 0;
  while ((m = MARKER_RE.exec(inner)) !== null) {
    const raw = m[1];
    const digit = /\d/.test(raw);
    out.push({
      idx: m.index + (m[0].length - m[0].trimStart().length),
      label: digit ? raw : raw.toUpperCase(),
      rank: digit ? Number(raw) : raw.toUpperCase().charCodeAt(0) - 64,
      end: MARKER_RE.lastIndex,
    });
  }
  return out;
}

/** Letters keep the long-standing rule — two or more "A."/"B." markers are a
 *  per-proposition list, whatever letter the author started at. Digits are far
 *  more likely to occur inside ordinary prose, so a numbered run counts only
 *  when it reads as a list: 1, 2, 3… with nothing missing. */
function isOrderedRun(markers: Marker[]): boolean {
  if (markers.length < 2) return false;
  const digits = markers.map((k) => /\d/.test(k.label));
  if (digits.some((d) => d !== digits[0])) return false; // no mixing 1. with B.
  if (!digits[0]) return true;
  return markers.every((k, i) => k.rank === i + 1);
}

function itemsHtml(items: { label: string; body: string }[]): string {
  // Separate each per-option explanation with a visible horizontal rule.
  return items.map((it) => `<p><strong>${it.label}.</strong> ${it.body}</p>`).join("<hr />");
}

/**
 * If an explanation string bundles multiple per-option justifications inside a
 * single paragraph (e.g. "A. ... B) ... C - ..." or "1. ... 2. ..."), split
 * them into one block per option. Otherwise return the input unchanged.
 *
 * Also handles the shape a .docx round trip produces: one paragraph whose
 * items are separated by <br> soft breaks.
 */
export function splitPerOptionExplanation(html: string): string {
  if (!html) return html;
  // Only touch flat content: skip if it already contains a list or multiple blocks.
  if (/<(ul|ol|li|table|h[1-6])\b/i.test(html)) return html;
  const blocks = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi);
  const inner =
    blocks && blocks.length === 1
      ? blocks[0].replace(/^<p\b[^>]*>/i, "").replace(/<\/p>\s*$/i, "")
      : blocks && blocks.length > 1
        ? null
        : html;
  if (inner === null) return html;

  // Already laid out one item per line (a .docx round trip): keep that
  // division rather than re-deriving it from the markers, so a line whose
  // justification itself mentions "3." stays in one piece.
  if (/<br\s*\/?>/i.test(inner)) {
    const lines = explanationLines(inner);
    if (lines.length < 2) return html;
    const labelled = lines.map((line) => {
      const m = line.match(/^((?:<[^>]+>\s*)*)([A-Ha-h]|[1-8])\s*[.)\-:]\s+([\s\S]*)$/);
      return m ? { label: /\d/.test(m[2]) ? m[2] : m[2].toUpperCase(), body: m[1] + m[3] } : null;
    });
    if (labelled.every((it): it is { label: string; body: string } => !!it && !!it.body.trim())) {
      return itemsHtml(labelled);
    }
    return lines.map((line) => `<p>${line}</p>`).join("");
  }

  const markers = markersOf(inner);
  if (!isOrderedRun(markers)) return html;
  const items: { label: string; body: string }[] = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].end;
    const stop = i + 1 < markers.length ? markers[i + 1].idx : inner.length;
    const body = inner.slice(start, stop).trim();
    if (!body) continue;
    items.push({ label: markers[i].label, body });
  }
  if (items.length < 2) return html;
  return itemsHtml(items);
}
