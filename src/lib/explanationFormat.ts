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

/**
 * How a question's propositions are labelled where the reader sees them.
 *
 * Two shapes, and the explanation has to match whichever one the reader is
 * looking at:
 *
 * - an ordinary question justifies its OPTIONS, which the paper letters
 *   A to E;
 * - an association question justifies the numbered items its énoncé carries
 *   ("Quels examens ? 1. FNS 2. CRP…"), whose options are combinations of
 *   those numbers ("1+2", "2+3") and so explain nothing on their own.
 *
 * Step 2 used to number every explanation 1, 2, 3 — the instruction was
 * written for association questions and then applied to all of them, so an
 * A-to-E question came back with its five justifications numbered.
 */
export type PropositionStyle = { kind: "letters" | "numbers"; count: number };

/** A numbered run inside a stem: "1." … "2." … contiguous from 1, at least
 *  two of them. Same rule as `isOrderedRun` uses on an explanation, and for
 *  the same reason — a lone "2." is far more likely to be prose. */
function numberedItemsInStem(stem: string): number {
  const text = (stem ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  const seen: number[] = [];
  const re = /(?:^|[\n\s ])([1-9])\s*[.)\-:]\s+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) seen.push(Number(m[1]));
  let n = 0;
  for (const value of seen) if (value === n + 1) n++;
  return n >= 2 ? n : 0;
}

export function propositionStyle(question: {
  stem?: string | null;
  choices?: string[] | null;
}): PropositionStyle {
  const numbered = numberedItemsInStem(question.stem ?? "");
  if (numbered) return { kind: "numbers", count: numbered };
  return { kind: "letters", count: question.choices?.length ?? 0 };
}

/** The label the nth proposition carries, in this style. */
function labelAt(style: PropositionStyle, index: number): string {
  return style.kind === "numbers" ? String(index + 1) : String.fromCharCode(65 + index);
}

/** A leading "A." / "<strong>1.</strong>" on one item, with whatever tags and
 *  whitespace open it. */
const LEADING_LABEL = /^((?:\s|<[^>]*>)*)([A-Ha-h]|[1-9])(\s*[.)\-:])/;

/**
 * Relabel an explanation's per-proposition items to the scheme the question
 * actually uses, keeping everything else — the markup, the wording, the order.
 *
 * Positional, because that is the only mapping that is sound: the model writes
 * its justifications in the order of the propositions, so the nth is about the
 * nth whatever it called it. Nothing is touched unless every item carries a
 * label and there are exactly as many as the question has propositions —
 * relabelling a list that does not line up would move a justification onto the
 * wrong option, which is worse than leaving it numbered.
 */
export function relabelPropositions(html: string, style: PropositionStyle): string {
  if (!html || style.count < 2) return html;
  for (const itemRe of [/<li\b[^>]*>[\s\S]*?<\/li>/gi, /<p\b[^>]*>[\s\S]*?<\/p>/gi]) {
    const items = html.match(itemRe);
    if (!items || items.length !== style.count) continue;
    if (!items.every((item) => LEADING_LABEL.test(item.replace(/^<(li|p)\b[^>]*>/i, "")))) continue;
    let i = 0;
    return html.replace(itemRe, (item) => {
      const open = item.match(/^<(?:li|p)\b[^>]*>/i)?.[0] ?? "";
      const label = labelAt(style, i++);
      return (
        open +
        item
          .slice(open.length)
          .replace(
            LEADING_LABEL,
            (_m, before: string, _old: string, sep: string) => `${before}${label}${sep}`,
          )
      );
    });
  }
  return html;
}
