/**
 * Clean the heading a clinical-case vignette carries from its source paper.
 *
 * Step 1 asks the model to recopy a case's énoncé verbatim, and a verbatim
 * copy includes the paper's own label: "Cas clinique N°12 : Patiente âgée de
 * 60 ans…", "CC7 : Une patiente de 32 ans…". That number is the source
 * document's, and the app renumbers its cases from 1 as it writes them — so
 * the label survives into the .docx, the JSON and the database as an énoncé
 * that announces a case number nothing else agrees with.
 */

/**
 * The label at the very start of a vignette.
 *
 * Two shapes, and both must be unambiguous before anything is removed:
 *
 * - the spelled-out keywords, the same set `CASE_MARKER_LINE`
 *   (questionChunks.ts) recognises on a line of its own;
 * - the "CC7" abbreviation these papers use, which that regex does not cover
 *   because on its own line it would be far too easy a match.
 *
 * A keyword alone is not enough to strip: a vignette opening "Cas clinique du
 * patient…" would lose its first two words. The keyword must be followed by a
 * number, a separator, or both — which every real label has.
 */
const CASE_LABEL_PREFIX = new RegExp(
  "^\\s*(?:" +
    // "Cas clinique n°12 :", "Observation clinique 3 -", "Vignette :"
    "(?:cas\\s+clinique|cas\\s*n°|observation(?:\\s+clinique)?|vignette(?:\\s+clinique)?|" +
    "énoncé\\s+commun|enonce\\s+commun)" +
    "(?:\\s*(?:n°|no|num[ée]ro|#)?\\s*\\d{1,3}\\s*[.):\\-–—:]?|\\s*[.):\\-–—:])" +
    "|" +
    // "CC7 :", "CC 10 -" — the separator is required here, since two letters
    // and a digit are not on their own proof of a label.
    "cc\\s*\\d{1,3}\\s*[.):\\-–—:]" +
    ")\\s*",
  "i",
);

/** Text content of light HTML, for deciding whether anything is left. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop the leading case label from a vignette, keeping everything else —
 * including any inline markup that opened it.
 *
 * Returns the input unchanged when there is no label, and when removing it
 * would leave nothing: a vignette that is only "Cas clinique n°3" is a poor
 * énoncé, but an empty one is worse, and the admin can still see and fix it.
 */
export function stripCaseLabel(stem: string): string;
export function stripCaseLabel(stem: null | undefined): null;
export function stripCaseLabel(stem: string | null | undefined): string | null;
export function stripCaseLabel(stem: string | null | undefined): string | null {
  if (stem == null) return null;
  // Strip inside the leading tags, so "<p>Cas clinique n°2 : Homme…" keeps
  // its paragraph and loses only the label.
  const out = stem.replace(
    /^((?:\s*<[^>]+>\s*)*)([^<]*)/,
    (_m, tags: string, text: string) => tags + text.replace(CASE_LABEL_PREFIX, ""),
  );
  if (out === stem) return stem;
  return textOf(out) ? out : stem;
}

/** The same, applied to a question's `case_stem` in place. */
export function withCleanCaseStem<T extends { case_stem?: string | null }>(question: T): T {
  if (!question.case_stem) return question;
  const stem = stripCaseLabel(question.case_stem);
  return stem === question.case_stem ? question : { ...question, case_stem: stem };
}
