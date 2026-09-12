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

import { buildQuestionUnits, splitBlocks, isOptionLine, unitNumber } from "./questionChunks";
import { explanationLines } from "./explanationFormat";

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

/** "Question 3", "QCM 12.", "Cas n°2 :" — an explicit keyword makes this
 *  unambiguous, so the trailing separator is optional (the app's own .docx
 *  writes a bare "Question 3" heading with none). Mirrors
 *  QUESTION_START_KEYWORD in questionChunks.ts, which detects the same line
 *  as a unit boundary. */
const QUESTION_PREFIX_KEYWORD =
  /^\s*(?:Q(?:uestion)?|QCM|QCS|QROC|Cas)\s*[N°#]?\s*\d{1,3}\s*[.)\-:–]?\s*/i;
/** A bare "1." / "N°4:" marker. The separator stays REQUIRED here: without
 *  it, a stem legitimately opening "20 patients ont…" would lose its "20". */
const QUESTION_PREFIX_BARE = /^\s*[N°#]?\s*\d{1,3}\s*[.)\-:–]\s*/;
const OPTION_PREFIX = /^\s*[-•*]?\s*\(?([A-Ea-e])\s*[).:\-–]\s+/;
const ANSWER_LINE =
  /^\s*(?:réponses?|reponses?|corrigé|corrige|bonnes?\s+réponses?|answer)\s*(?:justes?|correctes?)?\s*[:\-–]\s*(.+)$/i;
const EXPLANATION_LINE =
  /^\s*(?:explications?|commentaires?|justifications?|correction|remarques?)\s*[:\-–]\s*(.*)$/i;

/** Strip the leading "1." / "Q3)" / "Question 3" marker from the stem,
 *  keeping inline HTML. */
function stripQuestionPrefix(html: string): string {
  return html
    .replace(/^((?:\s*<[^>]+>\s*)*)/, (m) => m)
    .replace(
      /^((?:\s*<[^>]+>\s*)*)([^<]*)/,
      (_m, tags: string, text: string) =>
        // Only one of the two ever applies: after stripping "Question 5. ",
        // running the bare pattern too could eat a number that belongs to the
        // stem itself ("Question 5. 20. patients ont…").
        tags +
        (QUESTION_PREFIX_KEYWORD.test(text)
          ? text.replace(QUESTION_PREFIX_KEYWORD, "")
          : text.replace(QUESTION_PREFIX_BARE, "")),
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
  return Array.from(new Set(compact))
    .filter((i) => i >= 0 && i < Math.max(optionCount, 5))
    .sort((a, b) => a - b);
}

/** Drop the "Explication :" keyword from a block's HTML, leaving any inline
 *  markup that wrapped it in place. */
function stripExplanationKeyword(html: string): string {
  return html.replace(
    /^((?:\s*<[^>]+>\s*)*)([^<]*)/,
    (_m, tags: string, text: string) => tags + text.replace(EXPLANATION_LINE, "$1"),
  );
}

/** Add an explanation block as one paragraph per line it was written on, so a
 *  per-proposition explanation stays one item per line all the way through. */
function pushExplanation(parts: string[], html: string): void {
  for (const line of explanationLines(html)) parts.push(`<p>${line}</p>`);
}

function parseUnit(
  unitHtml: string,
  header: {
    year_hint: string | null;
    rotation_hint: string | null;
    course_hint: string | null;
    case_stem: string | null;
  },
): LocalQuestion | null {
  const blocks = splitBlocks(unitHtml);
  if (blocks.length === 0) return null;

  // Pre-scan: does this unit contain any option lines (A./B./C. ...) at all?
  // A true QROC never has any; a QCM/QCS always has its options up front,
  // before any "Réponse:"/"Explication:" keyword. This tells us, while still
  // reading the stem, whether a later plain paragraph should keep extending
  // the stem (multi-paragraph QCM/QCS stem, options still to come) or is
  // already the QROC answer (no options anywhere in the unit).
  const hasAnyOptionLine = blocks.some((b) => isOptionLine(stripTags(b)));
  // When the unit answers with lettered options, a numbered line is not one
  // of them: it is an item of the proposition list the letters refer to
  // ("1. FNS … A. 1+2"), and belongs to the stem. A numbered line only counts
  // as an option in a paper that numbers its options instead of lettering
  // them, which is exactly when no lettered line appears.
  // OPTION_PREFIX is the lettered form only, so it doubles as the test for
  // "does this paper letter its options" (isOptionLine also accepts digits).
  const hasLetteredOption = blocks.some((b) => OPTION_PREFIX.test(stripTags(b)));
  const isOption = (text: string) =>
    hasLetteredOption ? OPTION_PREFIX.test(text) : isOptionLine(text);

  const stemParts: string[] = [];
  const choices: string[] = [];
  const explanationParts: string[] = [];
  let correct: number[] | null = null;
  let answerText: string | null = null;
  let inExplanation = false;

  for (const block of blocks) {
    const text = stripTags(block);
    if (!text && !/<(img|table)\b/i.test(block)) continue;
    const inner = innerHtml(block);

    const answerMatch = text.match(ANSWER_LINE);
    if (answerMatch) {
      correct = parseAnswerLetters(answerMatch[1], choices.length);
      // Keep the raw text too: on a QROC ("Réponse correcte : ECG et
      // troponine") there are no letters to parse, and letter-parsing alone
      // would silently discard the only answer the question has.
      answerText = answerMatch[1].trim() || null;
      inExplanation = false;
      continue;
    }

    const explMatch = text.match(EXPLANATION_LINE);
    if (explMatch) {
      inExplanation = true;
      // Read the HTML, not the flattened text: the .docx this parser usually
      // re-reads writes a per-proposition explanation as ONE paragraph whose
      // items are separated by soft breaks, so `stripTags` here is what used
      // to collapse "1. … 2. … 3. …" into a single run-on line.
      pushExplanation(explanationParts, stripExplanationKeyword(inner));
      continue;
    }

    if (inExplanation) {
      pushExplanation(explanationParts, inner);
      continue;
    }

    // A unit never opens with an option: the chunker cut the unit at this
    // line precisely because it starts a question. On a paper numbered "1."
    // rather than "Question 1", that opening line also matches the option
    // pattern — classifying it as one left the question with no stem at all,
    // so it was dropped outright and the admin was told the mode had simply
    // "read" fewer questions than it detected.
    if (isOption(text) && (stemParts.length > 0 || choices.length > 0)) {
      choices.push(stripOptionPrefix(inner).trim());
      continue;
    }

    if (choices.length === 0 && (stemParts.length === 0 || hasAnyOptionLine)) {
      // Still before any options: either this is the first block (always the
      // stem) or the unit does contain options later on, so this plain block
      // is a continuation of a multi-paragraph stem, not a QROC answer yet.
      const first = stemParts.length === 0;
      const part = first ? stripQuestionPrefix(inner).trim() : inner;
      // A heading that was nothing but the marker ("Question 3", as the
      // app's own .docx writes it) strips to empty. Test the TEXT, not the
      // markup: the .docx writes that heading bold, so what's left is
      // "<strong></strong>" — non-empty as a string, empty as content. Skip
      // it entirely rather than banking a phantom first part: on a QROC —
      // which has no option lines — that phantom pushes the real stem into
      // the answer branch below and loses the question altogether.
      if (first && !stripTags(part)) continue;
      stemParts.push(part);
    } else if (choices.length === 0) {
      // No options anywhere in this unit (true QROC): any block after the
      // stem, with no "Réponse:"/"Explication:" keyword, is the answer text
      // itself — never part of the question. Treating it as stem would hide
      // the correct answer inside the question the student is meant to solve.
      pushExplanation(explanationParts, inner);
    } else {
      // Trailing prose after the options with no keyword = explanation.
      pushExplanation(explanationParts, inner);
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
    correct_indices:
      hasChoices && correct && correct.length ? correct.filter((i) => i < choices.length) : null,
    model_answer: hasChoices
      ? null
      : (answerText ?? (explanationParts.length ? stripTags(explanationParts.join(" ")) : null)),
    explanation: explanationParts.length ? explanationParts.join("") : null,
    course_hint: header.course_hint,
    year_hint: header.year_hint,
    rotation_hint: header.rotation_hint,
    case_stem: header.case_stem,
  };
}

/** Parse every question found in an HTML chunk. Never throws. */
export function parseQuestionsLocally(html: string): LocalQuestion[] {
  return parseQuestionsLocallyReporting(html).questions;
}

/** Same parse, plus the numbers of the questions it had to give up on — so a
 *  shortfall can be reported as "questions 17, 19 non lues" instead of a bare
 *  count the admin cannot act on. */
export function parseQuestionsLocallyReporting(html: string): {
  questions: LocalQuestion[];
  droppedNumbers: (number | null)[];
} {
  const units = buildQuestionUnits(html);
  const out: LocalQuestion[] = [];
  const droppedNumbers: (number | null)[] = [];
  for (const unit of units) {
    try {
      const header = { ...unit.header };
      // A "Réponse : …" / "Explication : …" line from the previous question is
      // never a course title.
      if (
        header.course_hint &&
        (ANSWER_LINE.test(header.course_hint) || EXPLANATION_LINE.test(header.course_hint))
      ) {
        header.course_hint = null;
      }
      const q = parseUnit(unit.html, header);
      if (q) out.push(q);
      else droppedNumbers.push(unitNumber(unit.html));
    } catch {
      droppedNumbers.push(unitNumber(unit.html));
    }
  }
  return { questions: out, droppedNumbers };
}
