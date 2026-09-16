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

/**
 * Does this read like a patient vignette, or like a piece of something else?
 *
 * A page is now sent to the model in slices, so a request can begin halfway
 * down it — and whatever tops that slice gets reported as the case's shared
 * énoncé. On one real file that produced 34 "clinical cases" where the paper
 * had 19: a "Commentaire" paragraph, a numbered continuation ("12. Les
 * résultats des examens demandés…"), a sentence cut mid-flow ("une cyanose des
 * extrémités. La radiographie…").
 *
 * What every real vignette in that file does, and no fragment does, is open by
 * introducing a person and give their age. That is the test: a subject word
 * at the very start, an age soon after. Deliberately strict — mistaking a
 * vignette for a fragment merely leaves a case alone, while the reverse founds
 * a case on a stray paragraph.
 */
const VIGNETTE_OPENING =
  /^\s*(?:Un|Une|Le|La|L'|M\.|Mme|Mr|Monsieur|Madame|Homme|Femme|Patient|Patiente|Malade|Enfant|Jeune|Adolescent|Adolescente|Nourrisson|Nouveau-né)\b[\s\S]{0,140}?\d+\s*ans?\b/i;

export function looksLikeVignette(stem: string | null | undefined): boolean {
  const text = textOf(stem ?? "");
  return text.length > 0 && VIGNETTE_OPENING.test(text);
}

/** Normalized head of a vignette, for deciding whether two are the same one. */
function vignetteHead(stem: string): string {
  return textOf(stem)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase()
    .slice(0, 120);
}

/**
 * Give every question of a source page the case énoncé that page actually has.
 *
 * Two rules, both confined to a single page so nothing can leak between them:
 *
 * - a `case_stem` that is not a vignette is replaced by the nearest real one
 *   already seen on that page, or dropped when the page has none — a stray
 *   paragraph should never found a clinical case;
 * - two vignettes on one page that are the same vignette re-typed (the
 *   overlap between slices shows it twice) collapse to the first, while two
 *   genuinely different patients on one page stay two cases.
 */
export function resolvePageCases<
  T extends { case_stem?: string | null; source_page?: number | null },
>(questions: T[]): T[] {
  /** Per page: the vignettes seen so far, first one first. */
  const seen = new Map<number | string, { head: string; stem: string }[]>();
  return questions.map((q) => {
    const page = q.source_page ?? "?";
    const known = seen.get(page) ?? [];
    if (!seen.has(page)) seen.set(page, known);
    const stem = q.case_stem;
    if (!stem || !textOf(stem)) return q;

    if (looksLikeVignette(stem)) {
      const head = vignetteHead(stem);
      // The same vignette read twice off overlapping slices: one of them is
      // often a little shorter or re-typed, so compare heads and prefixes
      // rather than demanding an exact match.
      const same = known.find(
        (k) => k.head === head || k.head.startsWith(head) || head.startsWith(k.head),
      );
      if (!same) {
        known.push({ head, stem });
        return q;
      }
      return same.stem === stem ? q : { ...q, case_stem: same.stem };
    }

    // A fragment: it belongs to this page's case, or to no case at all.
    const inherited = known.length ? known[known.length - 1].stem : null;
    return { ...q, case_stem: inherited };
  });
}
