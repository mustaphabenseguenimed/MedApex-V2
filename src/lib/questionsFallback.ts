/**
 * Zero-credit local parser ("mode sans IA").
 *
 * Parses clean, predictably formatted documents (DOCX converted to HTML, or
 * PDF text turned into HTML) into questions WITHOUT calling any AI model.
 * Accurate when the source uses one element per line:
 *   1. / Q1 / QCM 1  → question stem
 *   A. B. C. …       → options
 *   Réponse : A, C   → correct answers
 *   Explication : …  → explanation
 */

import { buildQuestionUnits, splitBlocks, isOptionLine } from "./questionChunks";

export type LocalQuestion = {
  type: "qcm" | "qcs" | "qroc";
  stem: string;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  course_hint: string | null;
  year_hint: string | null;
  rotation_hint: string | null;
  case_stem: string | null;
};

const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Remove the outer block tag but keep inline formatting inside. */
function innerHtml(block: string): string {
  return block
    .replace(/^\s*<(?:p|h[1-6]|li|div)\b[^>]*>/i, "")
    .replace(/<\/(?:p|h[1-6]|li|div)>\s*$/i, "")
    .trim();
}

const QUESTION_PREFIX =
  /^\s*(?:(?:Q(?:uestion)?|QCM|QCS|QROC|Cas)\s*)?[N°#]?\s*\d{1,3}\s*[.)\-:–]\s*/i;
const OPTION_PREFIX = /^\s*[-•*]?\s*\(?([A-Ea-e])\s*[).:\-–]\s+/;
const ANSWER_LINE =
  /^\s*(?:réponses?|reponses?|corrigé|corrige|bonnes?\s+réponses?|answer)\s*(?:justes?|correctes?)?\s*[:\-–]\s*(.+)$/i;
const EXPLANATION_LINE =
  /^\s*(?:explications?|commentaires?|justifications?|correction|remarques?)\s*[:\-–]\s*(.*)$/i;

/** Strip the leading "1." / "Q3)" marker from the stem, keeping inline HTML. */
function stripQuestionPrefix(html: string): string {
  return html.replace(/^((?:\s*<[^>]+>\s*)*)/, (m) => m).replace(
    /^((?:\s*<[^>]+>\s*)*)([^<]*)/,
    (_m, tags: string, text: string) => tags + text.replace(QUESTION_PREFIX, ""),
  );
}

/** Strip "A." / "b)" from an option line, keeping inline HTML. */
function stripOptionPrefix(html: string): string {
  return html.replace(
    /^((?:\s*<[^>]+>\s*)*)([^<]*)/,
    (_m, tags: string, text: string) => tags + text.replace(OPTION_PREFIX, ""),
  );
}

/** "A, C" / "A et C" / "ac" → [0, 2] */
function parseAnswerLetters(raw: string, optionCount: number): number[] {
  const letters = (raw.toUpperCase().match(/\b[A-E]\b/g) ?? []).map((l) => l.charCodeAt(0) - 65);
  const compact =
    letters.length === 0
      ? Array.from(raw.toUpperCase().replace(/[^A-E]/g, "")).map((l) => l.charCodeAt(0) - 65)
      : letters;
  return Array.from(new Set(compact)).filter((i) => i >= 0 && i < Math.max(optionCount, 5)).sort((a, b) => a - b);
}

function parseUnit(unitHtml: string, header: { year_hint: string | null; rotation_hint: string | null; course_hint: string | null; case_stem: string | null }): LocalQuestion | null {
  const blocks = splitBlocks(unitHtml);
  if (blocks.length === 0) return null;

  // Pre-scan: does this unit contain any option lines (A./B./C. ...) at all?
  // A true QROC never has any; a QCM/QCS always has its options up front,
  // before any "Réponse:"/"Explication:" keyword. This tells us, while still
  // reading the stem, whether a later plain paragraph should keep extending
  // the stem (multi-paragraph QCM/QCS stem, options still to come) or is
  // already the QROC answer (no options anywhere in the unit).
  const hasAnyOptionLine = blocks.some((b) => isOptionLine(stripTags(b)));

  const stemParts: string[] = [];
  const choices: string[] = [];
  const explanationParts: string[] = [];
  let correct: number[] | null = null;
  let inExplanation = false;

  for (const block of blocks) {
    const text = stripTags(block);
    if (!text && !/<(img|table)\b/i.test(block)) continue;
    const inner = innerHtml(block);

    const answerMatch = text.match(ANSWER_LINE);
    if (answerMatch) {
      correct = parseAnswerLetters(answerMatch[1], choices.length);
      inExplanation = false;
      continue;
    }

    const explMatch = text.match(EXPLANATION_LINE);
    if (explMatch) {
      inExplanation = true;
      const rest = explMatch[1]?.trim();
      if (rest) explanationParts.push(`<p>${rest}</p>`);
      continue;
    }

    if (inExplanation) {
      explanationParts.push(`<p>${inner}</p>`);
      continue;
    }

    if (isOptionLine(text)) {
      choices.push(stripOptionPrefix(inner).trim());
      continue;
    }

    if (choices.length === 0 && (stemParts.length === 0 || hasAnyOptionLine)) {
      // Still before any options: either this is the first block (always the
      // stem) or the unit does contain options later on, so this plain block
      // is a continuation of a multi-paragraph stem, not a QROC answer yet.
      stemParts.push(stemParts.length === 0 ? stripQuestionPrefix(inner).trim() : inner);
    } else if (choices.length === 0) {
      // No options anywhere in this unit (true QROC): any block after the
      // stem, with no "Réponse:"/"Explication:" keyword, is the answer text
      // itself — never part of the question. Treating it as stem would hide
      // the correct answer inside the question the student is meant to solve.
      explanationParts.push(`<p>${inner}</p>`);
    } else {
      // Trailing prose after the options with no keyword = explanation.
      explanationParts.push(`<p>${inner}</p>`);
    }
  }

  const stem = stemParts.filter(Boolean).join(" ").trim();
  if (!stem) return null;

  const hasChoices = choices.length >= 2;
  const type: LocalQuestion["type"] = !hasChoices
    ? "qroc"
    : correct && correct.length > 1
      ? "qcm"
      : "qcs";

  return {
    type,
    stem,
    choices: hasChoices ? choices : null,
    correct_indices: hasChoices && correct && correct.length ? correct.filter((i) => i < choices.length) : null,
    model_answer: !hasChoices && explanationParts.length ? stripTags(explanationParts.join(" ")) : null,
    explanation: explanationParts.length ? explanationParts.join("") : null,
    course_hint: header.course_hint,
    year_hint: header.year_hint,
    rotation_hint: header.rotation_hint,
    case_stem: header.case_stem,
  };
}

/** Parse every question found in an HTML chunk. Never throws. */
export function parseQuestionsLocally(html: string): LocalQuestion[] {
  const units = buildQuestionUnits(html);
  const out: LocalQuestion[] = [];
  for (const unit of units) {
    try {
      const header = { ...unit.header };
      // A "Réponse : …" / "Explication : …" line from the previous question is
      // never a course title.
      if (header.course_hint && (ANSWER_LINE.test(header.course_hint) || EXPLANATION_LINE.test(header.course_hint))) {
        header.course_hint = null;
      }
      const q = parseUnit(unit.html, header);
      if (q) out.push(q);
    } catch {
      // skip malformed unit
    }
  }
  return out;
}