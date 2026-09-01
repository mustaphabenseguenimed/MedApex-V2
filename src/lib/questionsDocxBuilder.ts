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
    new Paragraph({ text: stripHtml(item.stem) }),
  ];
  if (item.choices && item.choices.length) {
    item.choices.forEach((c, i) => {
      paras.push(new Paragraph({ text: `${LETTERS[i] ?? i + 1}. ${stripHtml(c)}` }));
    });
  }
  paras.push(new Paragraph({ text: answerLine(item) }));
  if (includeExplanations && item.explanation) {
    paras.push(new Paragraph({ text: `Explication : ${stripHtml(item.explanation)}` }));
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
      children.push(new Paragraph({ text: stripHtml(key) }));
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
