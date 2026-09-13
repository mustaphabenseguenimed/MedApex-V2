/**
 * The .json the conversion tool writes — step 3's download and "Continuer",
 * the per-file downloads, the library, and step 4's own export all come
 * through `toJsonObjects`.
 *
 * It is the only representation of an extracted question that leaves the app,
 * so anything it omits is lost for good: it has to carry what the step 3
 * preview shows, and stay readable by `parseQuestionsJson` on the way back in.
 *
 * Kept free of React and server-only imports so the round trip can be tested
 * against the real reader.
 */

import type { ExtractedQ } from "./questions.functions";

// Truncated, normalized prefix rather than an exact match: the AI can retype
// the same shared vignette with tiny differences (trailing punctuation, a
// dropped <br>, minor whitespace) across two adjacent chunks — an exact
// compare would silently break the cas-clinique grouping and orphan the
// continuation question as a standalone. It is a GROUPING key only: never
// export it as the vignette's text, which is what used to cut every énoncé in
// a generated .json down to 80 lowercase characters.
export function caseKey(q: { case_stem?: string | null }): string {
  return (q.case_stem ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

export function stripHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** On the way back out (reading a generated .docx), the combined rotation
 *  line usually lands entirely in rotation_hint with year_hint left null —
 *  split it back into separate "Rotation"/"Year" values for the JSON step. */
export function splitRotationYear(q: ExtractedQ): { rotation: string; year: string } {
  if (q.year_hint) return { rotation: q.rotation_hint ?? "", year: q.year_hint };
  const raw = (q.rotation_hint ?? "").trim();
  if (!raw) return { rotation: "", year: "" };
  const m = raw.match(/^(\S+)\s+(.*)$/);
  return m ? { rotation: m[1], year: m[2].trim() } : { rotation: raw, year: "" };
}

/** Markup plain text cannot represent: an image or a table disappears
 *  entirely, and the line breaks an association question (or a numbered
 *  explanation) is written with collapse onto one line. */
const CONTENT_MARKUP = /<(img|table|tr|td|th|br|ul|ol|li)\b/i;

/** Text field as it should be written to the .json: its own HTML when that
 *  HTML carries content, clean text otherwise — so ordinary questions stay
 *  plainly readable in the file while nothing is silently dropped. */
function jsonText(html: string | null | undefined): string {
  const raw = (html ?? "").trim();
  return CONTENT_MARKUP.test(raw) ? raw : stripHtml(raw);
}

/** Hint arrays are worth writing only when they hold more than the single
 *  value "Rotation"/"Year" already carry — the reader prefers these keys, so
 *  writing them always would just shadow the split values. */
function multiHints(q: ExtractedQ): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if ((q.rotation_hints?.length ?? 0) > 1) out.rotation_hints = q.rotation_hints as string[];
  if ((q.year_hints?.length ?? 0) > 1) out.year_hints = q.year_hints as string[];
  return out;
}

function jsonQuestion(q: ExtractedQ): Record<string, unknown> {
  return {
    type: q.type,
    stem: jsonText(q.stem),
    choices: q.choices ? q.choices.map((c) => jsonText(c)) : null,
    correct_indices: q.correct_indices ?? null,
    ...(q.model_answer ? { model_answer: jsonText(q.model_answer) } : {}),
    // Explanation stays HTML (not stripped) so images and the per-proposition
    // lines survive the JSON round trip — structuredImport.ts already passes
    // an already-HTML explanation through untouched on the way back in.
    explanation: q.explanation || null,
    ...(q.course_hint ? { course_hint: q.course_hint } : {}),
  };
}

/**
 * Enforce "rotation/année belong to the case, not to its questions".
 *
 * Step 4's "Appliquer" writes them on the group's lead, but hints also arrive
 * from the document itself: `parseContextHints` attaches the "Rotation : P3
 * 2024" line above a case to every unit it reads under it, so sub-questions
 * can turn up already carrying one. Clearing them on the way in means the
 * rule holds for the whole file, not only for the groups a capture page
 * covered.
 */
export function caseHintsOnLead<T extends ExtractedQ>(items: T[]): T[] {
  const out = items.slice();
  let i = 0;
  while (i < out.length) {
    const key = caseKey(out[i]);
    let j = i + 1;
    if (key) {
      while (j < out.length && caseKey(out[j]) === key) {
        out[j] = { ...out[j], rotation_hint: null, year_hint: null };
        if (out[j].rotation_hints) out[j] = { ...out[j], rotation_hints: null };
        if (out[j].year_hints) out[j] = { ...out[j], year_hints: null };
        j++;
      }
    }
    i = j;
  }
  return out;
}

/**
 * Strip every rotation/année hint from a question list.
 *
 * Step 1 (PDF → DOCX) does not deal in rotations at all: what the model reads
 * off a page is a guess, and once written into the document it is attached by
 * `parseContextHints` to every unit read underneath it in the later steps.
 * Rotations are set in step 4, from the capture PDF the admin provides.
 */
export function withoutRotationHints<T extends ExtractedQ>(items: T[]): T[] {
  return items.map((q) =>
    q.rotation_hint || q.year_hint || q.rotation_hints || q.year_hints
      ? { ...q, rotation_hint: null, year_hint: null, rotation_hints: null, year_hints: null }
      : q,
  );
}

/** Group the extracted questions into the app's own .json shape: one object
 *  per clinical case (its énoncé plus its sub-questions) or per standalone
 *  question, each carrying its rotation/année. */
export function toJsonObjects(qs: ExtractedQ[]): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < qs.length) {
    const key = caseKey(qs[i]);
    if (key) {
      const group: ExtractedQ[] = [];
      while (i < qs.length && caseKey(qs[i]) === key) {
        group.push(qs[i]);
        i++;
      }
      const lead = group[0];
      const { rotation, year } = splitRotationYear(lead);
      out.push({
        Rotation: rotation,
        Year: year,
        ...multiHints(lead),
        // The group's own énoncé, never `key`: that one is lowercased and cut
        // to 80 characters for grouping purposes.
        "cas clinique stem": jsonText(lead.case_stem),
        ...(lead.course_hint ? { course_hint: lead.course_hint } : {}),
        questions: group.map(jsonQuestion),
      });
    } else {
      const q = qs[i];
      const { rotation, year } = splitRotationYear(q);
      out.push({
        Rotation: rotation,
        Year: year,
        ...multiHints(q),
        ...jsonQuestion(q),
      });
      i++;
    }
  }
  return out;
}
