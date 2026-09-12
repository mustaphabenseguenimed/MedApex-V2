import { Document, Packer, Paragraph, TextRun } from "docx";

/**
 * Minimal question shape needed to write a .docx in the app's own
 * "Question N / lettered or numbered choices / Réponse correcte :" layout —
 * the same layout `questionChunks.ts` already knows how to read back.
 */
export type DocxQuestionItem = {
  stem: string;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer?: string | null;
  explanation?: string | null;
  case_stem?: string | null;
  rotation_hint?: string | null;
};

const LETTERS = "ABCDEFGH";

/** Normalized, truncated grouping key — mirrors admin.convert.tsx's
 *  caseKey (truncated prefix, not an exact match, so minor AI re-typing of
 *  the same vignette across chunks doesn't break the grouping) so both
 *  agree on which questions share the same clinical-case vignette. */
function caseKey(item: DocxQuestionItem): string {
  return (item.case_stem ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, 80);
}

function stripHtml(html: string): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split text or light HTML into the lines it was meant to be read as.
 *
 *  An association question carries its numbered items inside the stem
 *  ("Associer …:\n1. FNS\n2. CRP…"), and a per-proposition explanation
 *  arrives as an HTML list. `stripHtml` alone flattens both into one long
 *  line, which is how they used to land in the .docx. */
function textLines(html: string): string[] {
  const withBreaks = (html ?? "")
    // Block and list boundaries are line boundaries.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n");
  return withBreaks
    .split("\n")
    .map((line) => stripHtml(line))
    .filter((line) => line.length > 0);
}

/**
 * One paragraph whose lines are separated by *soft* breaks, not by paragraph
 * breaks.
 *
 * This matters beyond looks. Step 2 routinely re-reads the .docx Step 1
 * wrote, and `questionChunks.ts` splits that document on paragraph elements
 * (`<p>`, `<li>`, `<div>`) while treating a `<br>` as ordinary whitespace.
 * Real paragraphs here would turn "1. FNS + groupage" into its own block,
 * which `OPTION_LINE` reads as an answer option and `QUESTION_START_BARE`
 * as a possible new question — corrupting the re-read of the app's own
 * output. A soft break renders as a new line in Word and collapses back to
 * the same single block on the way in.
 */
function linesParagraph(lines: string[], prefix?: string): Paragraph {
  const all = prefix ? [prefix, ...lines] : lines;
  return new Paragraph({
    children: all.map(
      (line, i) => new TextRun(i === 0 ? { text: line } : { text: line, break: 1 }),
    ),
  });
}

function answerLine(item: DocxQuestionItem): string {
  if (item.choices && item.choices.length) {
    const letters = (item.correct_indices ?? []).map((i) => LETTERS[i] ?? String(i + 1));
    return `Réponse correcte : ${letters.join(" + ") || "?"}`;
  }
  return `Réponse correcte : ${stripHtml(item.model_answer ?? "")}`;
}

function rotationParagraph(item: DocxQuestionItem): Paragraph[] {
  return item.rotation_hint ? [new Paragraph({ text: `Rotation : ${item.rotation_hint}` })] : [];
}

function questionParagraphs(
  item: DocxQuestionItem,
  qNum: number,
  includeExplanations: boolean,
): Paragraph[] {
  const paras: Paragraph[] = [
    new Paragraph({ children: [new TextRun({ text: `Question ${qNum}`, bold: true })] }),
    linesParagraph(textLines(item.stem)),
  ];
  if (item.choices && item.choices.length) {
    item.choices.forEach((c, i) => {
      paras.push(new Paragraph({ text: `${LETTERS[i] ?? i + 1}. ${stripHtml(c)}` }));
    });
  }
  paras.push(new Paragraph({ text: answerLine(item) }));
  if (includeExplanations && item.explanation) {
    const lines = textLines(item.explanation);
    paras.push(
      lines.length > 1
        ? linesParagraph(lines, "Explication :")
        : new Paragraph({ text: `Explication : ${lines[0] ?? ""}` }),
    );
  }
  paras.push(new Paragraph({ text: "" }));
  return paras;
}

/**
 * Build a .docx from a flat, ordered list of questions. Consecutive items
 * sharing a `case_stem` are grouped under one "Cas clinique n°N :" block;
 * everything else is written as a standalone question. Returns base64.
 */
export async function buildQuestionsDocx(
  items: DocxQuestionItem[],
  includeExplanations: boolean,
): Promise<string> {
  const children: Paragraph[] = [];
  let qNum = 0;
  let caseNum = 0;
  let i = 0;
  while (i < items.length) {
    const item = items[i];
    const key = caseKey(item);
    if (key) {
      const group: DocxQuestionItem[] = [];
      while (i < items.length && caseKey(items[i]) === key) {
        group.push(items[i]);
        i++;
      }
      caseNum++;
      children.push(...rotationParagraph(group[0]));
      children.push(
        new Paragraph({
          children: [new TextRun({ text: `Cas clinique n°${caseNum} :`, bold: true })],
        }),
      );
      children.push(linesParagraph(textLines(group[0].case_stem ?? "")));
      for (const sub of group) {
        qNum++;
        children.push(...questionParagraphs(sub, qNum, includeExplanations));
      }
    } else {
      children.push(...rotationParagraph(item));
      qNum++;
      children.push(...questionParagraphs(item, qNum, includeExplanations));
      i++;
    }
  }
  const doc = new Document({ sections: [{ children }] });
  return Packer.toBase64String(doc);
}
