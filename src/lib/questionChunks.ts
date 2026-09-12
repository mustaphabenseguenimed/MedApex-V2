/**
 * Pure helpers that split an imported document (Word HTML or PDF text turned
 * into HTML) into per-question units, and read the context line(s) written
 * above each question (année / rotation / cours).
 *
 * Shared by the server-side chunk preparation and the client-side review step,
 * so both agree on how many questions a chunk is supposed to contain.
 */

export type QHeader = {
  year_hint: string | null;
  rotation_hint: string | null;
  course_hint: string | null;
  /** Shared clinical-case vignette this question belongs to, if any. */
  case_stem: string | null;
  /** Long leading paragraph before the first question, with no structured
   *  hint and no explicit "Cas clinique" marker — likely an implicit shared
   *  vignette, forwarded to the AI as context so it can still detect the
   *  case even though we don't assert case_stem ourselves. */
  doc_intro: string | null;
};

export type QuestionUnit = {
  /** HTML of the question (header lines included). */
  html: string;
  /** Plain text of the question, used for matching AI output back to units. */
  text: string;
  header: QHeader;
};

export type PreparedChunk = {
  html: string;
  colorHint: string;
  /** How many questions this chunk is supposed to contain. */
  expected: number;
  /** Per-question context, aligned with the order of questions in the chunk. */
  contexts: QHeader[];
  /** First ~140 chars of each question, for fuzzy re-alignment. */
  stems: string[];
};

const stripTags = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** A keyword-anchored question start: "Question 4", "QCM 12)", "Q3:" — and,
 *  since the keyword alone is unambiguous, also a bare "Question 4" with NO
 *  trailing punctuation (very common: Word often puts just the number on
 *  its own line with nothing after it). */
const QUESTION_START_KEYWORD =
  /^\s*(?:<[^>]+>\s*)*(?:Q(?:uestion)?|QCM|QCS|QROC|Cas)\s*[N°#]?\s*\d{1,3}\s*[.)\-:–]?/i;

/** A bare numbered start with no keyword: "1.", "N°4:". Ambiguous with a
 *  numbered *option* line ("1. Some choice text") — callers must also check
 *  `isOptionLine` before trusting this as a real question boundary. */
const QUESTION_START_BARE = /^\s*(?:<[^>]+>\s*)*[N°#]?\s*\d{1,3}\s*[.)\-:–]/;

/** An answer-option line: "A.", "b)", "- C -", "1.", "2)". */
const OPTION_LINE = /^\s*[-•*]?\s*\(?([A-Ea-e]|[1-9])\s*[).:\-–]\s+/;
/** Only the lettered form — used to tell which style a document uses for its
 *  choices, since a numbered line is ambiguous but a lettered one never is. */
const LETTERED_OPTION_LINE = /^\s*[-•*]?\s*\(?([A-Ea-e])\s*[).:\-–]\s+/;

export function isQuestionStart(text: string): boolean {
  return QUESTION_START_KEYWORD.test(text) || QUESTION_START_BARE.test(text);
}
/** A question start that's unambiguous even without checking `isOptionLine` —
 *  i.e. it has an explicit keyword, so it can never be a numbered choice. */
export function isUnambiguousQuestionStart(text: string): boolean {
  return QUESTION_START_KEYWORD.test(text);
}
export function isOptionLine(text: string): boolean {
  return OPTION_LINE.test(text);
}

// ---- context (année / rotation / cours) ------------------------------------

const YEAR_RE =
  /((?:\d{1,2})\s*(?:è?re|ème|eme|er)?\s*(?:année|annee|an\b)|(?:DCEM|PCEM|DFGSM|DFASM)\s*\d|(?:\b[1-7]\s*A\b)|(?:\bA[1-7]\b)|(?<!\d)(20\d{2})(?!\d))/i;
const ROTATION_RE =
  /((?:rotation|rot\.?|période|periode|stage)\s*n?°?\s*\d{1,2}|\bP\s?\d{1,2}\b|\bR\s?\d{1,2}\b|résidanat\s*\d{4}|residanat\s*\d{4}|résidanat|residanat)/i;
/** An explicit "Rotation : <value>" label line — captures the value verbatim
 *  (e.g. "P3 2010" in full) instead of the looser ROTATION_RE, which would
 *  only recover the "P3" token and drop the year. Takes priority when present. */
const ROTATION_LABEL_RE = /^\s*rotation\s*[:\-–]\s*(.+)$/i;
const COURSE_RE = /(?:cours|chapitre|module|matière|matiere|thème|theme|item)\s*[:\-–]\s*(.+)$/i;

/** A line that is clearly leftover from the previous question's answer/explanation, never a header for the next one. */
const ANSWER_OR_EXPLANATION_LINE =
  /^\s*(?:réponses?|reponses?|corrigé|corrige|bonnes?\s+réponses?|answer|explications?|commentaires?|justifications?|correction|remarques?)\s*(?:justes?|correctes?)?\s*[:\-–]/i;

/**
 * An EXPLICIT clinical-case marker line, e.g. "Cas clinique n°1", "Cas clinique 2 :",
 * "Observation clinique n°1", "Observation :", "Vignette :", "Cas clinique n°1 :
 * Douleur thoracique". Deliberately narrow (never a bare "Cas 1.") so a vignette is
 * only ever attached when the source unambiguously labels it as one — silence is
 * safer than a wrong guess. A short trailing title is allowed after the marker
 * (real documents often name the case), but it's capped at 80 chars and cut off at
 * the first sentence-ending punctuation so a full prose paragraph never matches.
 */
const CASE_MARKER_LINE =
  /^\s*(?:cas\s+clinique|cas\s+n°|observation(?:\s+clinique)?|vignette(?:\s+clinique)?|énoncé\s+commun|enonce\s+commun)\b\s*(?:n°|no|numero|#)?\s*\d{0,3}\s*(?:[.):\-–]\s*[^.!?]{0,80})?\s*$/i;

export function isCaseMarkerLine(text: string): boolean {
  return CASE_MARKER_LINE.test(text.trim());
}

/**
 * Read année / rotation / cours from one or more context lines placed above a
 * question (or on the question's own first line). Lines that are option
 * lines, answer/explanation lines, or trailing prose left over from the
 * previous question must never be treated as a header for this one.
 */
export function parseContextHints(lines: string[]): QHeader {
  const out: QHeader = {
    year_hint: null,
    rotation_hint: null,
    course_hint: null,
    case_stem: null,
    doc_intro: null,
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (isOptionLine(line) || ANSWER_OR_EXPLANATION_LINE.test(line) || isCaseMarkerLine(line))
      continue;
    if (!out.year_hint) {
      const m = line.match(YEAR_RE);
      if (m) out.year_hint = (m[1] || m[2]).trim();
    }
    if (!out.rotation_hint) {
      const label = line.match(ROTATION_LABEL_RE);
      if (label) {
        out.rotation_hint = label[1].trim();
      } else {
        const m = line.match(ROTATION_RE);
        if (m) out.rotation_hint = m[1].trim();
      }
    }
    if (!out.course_hint) {
      const m = line.match(COURSE_RE);
      if (m) {
        out.course_hint = m[1].trim().slice(0, 120);
      } else if (
        // A short standalone line that is not a question and not an option is
        // very likely the course title.
        line.length <= 90 &&
        !isQuestionStart(line) &&
        !isOptionLine(line) &&
        /[a-zA-Zà-ÿ]{4,}/.test(line) &&
        !YEAR_RE.test(line) &&
        !ROTATION_RE.test(line)
      ) {
        out.course_hint = line;
      }
    }
  }
  return out;
}

function mergeHeader(base: QHeader, extra: QHeader): QHeader {
  return {
    year_hint: extra.year_hint ?? base.year_hint,
    rotation_hint: extra.rotation_hint ?? base.rotation_hint,
    course_hint: extra.course_hint ?? base.course_hint,
    case_stem: extra.case_stem ?? base.case_stem,
    doc_intro: extra.doc_intro ?? base.doc_intro,
  };
}

// ---- block splitting -------------------------------------------------------

/** Split HTML into top-level blocks, keeping <table> elements whole. */
export function splitBlocks(html: string): string[] {
  const tableRe = /<table\b[\s\S]*?<\/table>/gi;
  const tables: string[] = [];
  const sentinel = "\uE000TABLE_BLOCK_";
  const withSentinels = html.replace(tableRe, (m) => {
    const idx = tables.push(m) - 1;
    return `<p data-table="${idx}">${sentinel}${idx}\uE001</p>`;
  });
  const blockRe = /<(?:p|h[1-6]|li|div)\b[^>]*>[\s\S]*?<\/(?:p|h[1-6]|li|div)>/gi;
  const rawBlocks = withSentinels.match(blockRe) ?? [withSentinels];
  return rawBlocks
    .map((b) =>
      b.replace(new RegExp(`${sentinel}(\\d+)\uE001`, "g"), (_m, i) => tables[Number(i)] ?? ""),
    )
    .filter((b) => stripTags(b).length > 0 || /<(img|table)\b/i.test(b));
}

/**
 * Find explicit clinical-case vignettes: a marker line ("Cas clinique n°1")
 * followed by one or more prose blocks (not a question, not an option), read
 * up until the next question start. Returns, for each vignette, the set of
 * question-start indices it actually covers: the run of consecutive
 * questions starting right after the vignette, stopping as soon as any block
 * appears between two questions that isn't itself part of that question's
 * own body (options/answer/explanation) — such a block signals a new topic
 * (a new title, or another vignette) and ends the case.
 */
function findCaseVignettes(
  texts: string[],
  starts: number[],
): { text: string; coveredStarts: Set<number>; proseIndices: Set<number> }[] {
  const out: { text: string; coveredStarts: Set<number>; proseIndices: Set<number> }[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (!isCaseMarkerLine(texts[i])) continue;
    const proseParts: string[] = [];
    const proseIndices = new Set<number>();
    let j = i + 1;
    while (
      j < texts.length &&
      !starts.includes(j) &&
      !isOptionLine(texts[j]) &&
      !isCaseMarkerLine(texts[j])
    ) {
      if (texts[j].trim()) {
        proseParts.push(texts[j].trim());
        proseIndices.add(j);
      }
      j++;
    }
    const text = proseParts.join(" ").trim();
    if (!text || !starts.includes(j)) continue; // no question actually follows this marker

    // Walk the consecutive questions right after the vignette. Stop as soon
    // as the gap between one question's body and the next start contains a
    // block that is not part of that question's own body (options, "Réponse
    // :", "Explication :" and its continuation lines) — that block is a new
    // heading/topic, so the vignette no longer applies beyond it.
    const coveredStarts = new Set<number>();
    let s = starts.indexOf(j);
    for (; s < starts.length; s++) {
      const from = starts[s];
      const to = s + 1 < starts.length ? starts[s + 1] : texts.length;
      coveredStarts.add(from);
      // Scan this question's own block range for a trailing block that isn't
      // part of its body (option, "Réponse :", "Explication :", or a
      // continuation line right after "Explication :") — such a block is a
      // new heading/topic that ends the case right here.
      let inExplanation = false;
      // Has this question's own content started (options / answer / explanation)?
      // Until it has, plain prose is still the question's STEM.
      let pastStem = false;
      let interrupted = false;
      for (let k = from + 1; k < to; k++) {
        const t = texts[k];
        if (isOptionLine(t)) {
          pastStem = true;
          inExplanation = false;
          continue;
        }
        if (ANSWER_LINE_ONLY.test(t)) {
          pastStem = true;
          inExplanation = false;
          continue;
        }
        if (EXPLANATION_LINE_ONLY.test(t)) {
          pastStem = true;
          inExplanation = true;
          continue;
        }
        // Prose before any option/answer line is this question's own stem, not
        // a new topic. Without this the very first stem ended the case: every
        // document that puts the stem on its own line under a "Question N"
        // heading — which is exactly what buildQuestionsDocx writes — attached
        // the vignette to the case's FIRST question only, so the rest imported
        // as standalone questions instead of sub-questions of the case.
        if (!pastStem) continue;
        // A short standalone line looks like a heading, not explanation prose,
        // even while "inExplanation" — treat it as the interruption rather
        // than silently folding it into the case.
        const looksLikeHeading =
          t.trim().length > 0 && t.trim().length <= 90 && !/[.!?]\s*$/.test(t.trim());
        if (inExplanation && !looksLikeHeading) continue; // explanation continuation line
        interrupted = true;
        break;
      }
      if (interrupted) break;
    }
    out.push({ text, coveredStarts, proseIndices });
  }
  return out;
}

const ANSWER_LINE_ONLY =
  /^\s*(?:réponses?|reponses?|corrigé|corrige|bonnes?\s+réponses?|answer)\s*(?:justes?|correctes?)?\s*[:\-–]/i;
const EXPLANATION_LINE_ONLY =
  /^\s*(?:explications?|commentaires?|justifications?|correction|remarques?)\s*[:\-–]/i;

/**
 * Group blocks into question units. Numbered documents use the "1." marker;
 * documents without numbering are grouped by option runs (a block followed by
 * A./B./C. lines starts a new question).
 */
export function buildQuestionUnits(html: string, detectCases = true): QuestionUnit[] {
  const blocks = splitBlocks(html);
  const texts = blocks.map(stripTags);
  const numbered = texts.some((t) => isQuestionStart(t));

  const starts: number[] = [];
  if (numbered) {
    // A keyword-anchored match ("Question 4") is always a real boundary.
    const keywordStarts = new Set<number>();
    texts.forEach((t, i) => {
      if (isUnambiguousQuestionStart(t)) keywordStarts.add(i);
    });

    // A bare numeric line ("1.") is ambiguous. It can open a question, or be
    // one item of a numbered proposition list inside a single question's stem
    // — "cochez la réponse juste / 1. … 2. … 3. …", answered by lettered
    // options like "A. 1+2". What tells them apart is what sits BETWEEN two
    // consecutive numbered lines: real questions are separated by their own
    // lettered options, propositions follow each other back to back. So group
    // the bare candidates into runs broken by a lettered option (or by a
    // keyword question) and keep only the runs of one; a run of several
    // consecutive numbered lines is a proposition list and belongs to the
    // stem it sits in.
    const bare = texts
      .map((_t, i) => i)
      .filter((i) => !keywordStarts.has(i) && isQuestionStart(texts[i]))
      // A numbered line sitting directly under a question heading is that
      // question's own stem, not a second question. Papers routinely carry
      // two numberings — the heading the compiler added and the original
      // exam's number on the stem line:
      //   Question 16
      //   30. Devant ce tableau radiologique, vous évoquez…
      //   A. …
      // Counting both split every such question in two: a heading with no
      // body (dropped outright, since it parses to an empty stem) and a body
      // labelled 30 instead of 16 — which is exactly how a paper reads
      // "détectée(s) 4 / lue(s) 2" with numbering like 16, 30, 17, 31.
      .filter((i) => i === 0 || !keywordStarts.has(i - 1));
    const separated = (from: number, to: number) => {
      for (let k = from + 1; k < to; k++) {
        if (LETTERED_OPTION_LINE.test(texts[k]) || keywordStarts.has(k)) return true;
      }
      return false;
    };
    const acceptedBare = new Set<number>();
    for (let r = 0; r < bare.length;) {
      let end = r;
      while (end + 1 < bare.length && !separated(bare[end], bare[end + 1])) end++;
      if (end === r) acceptedBare.add(bare[r]);
      r = end + 1;
    }

    texts.forEach((_t, i) => {
      if (keywordStarts.has(i) || acceptedBare.has(i)) starts.push(i);
    });
  } else {
    // Unnumbered: the last non-option block right before an option run is the
    // question stem, so it starts a new question.
    for (let i = 0; i < texts.length; i++) {
      if (isOptionLine(texts[i])) continue;
      if (texts[i + 1] && isOptionLine(texts[i + 1])) starts.push(i);
    }
  }

  if (starts.length === 0) return [];

  const vignettes = detectCases ? findCaseVignettes(texts, starts) : [];
  const allVignetteProseIndices = new Set<number>();
  vignettes.forEach((v) => v.proseIndices.forEach((i) => allVignetteProseIndices.add(i)));

  // Document-level context = everything before the first question, excluding
  // any vignette marker/prose lines (those describe a case, not the course).
  const leadingTexts = texts.slice(0, starts[0]).filter((_, i) => !allVignetteProseIndices.has(i));
  const docHeader = parseContextHints(leadingTexts);
  // A long leading paragraph (a real sentence, not a short label like "P3
  // 2026") that isn't behind an explicit "Cas clinique" marker is very
  // likely an implicit shared vignette — forward it as-is so the AI can
  // still detect the shared case, without us asserting case_stem ourselves.
  const DOC_INTRO_MIN_LEN = 150;
  const docIntro = detectCases
    ? leadingTexts
        .filter((t) => t.trim().length >= DOC_INTRO_MIN_LEN)
        .join(" ")
        .trim()
    : "";
  docHeader.doc_intro = docIntro || null;

  const units: QuestionUnit[] = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s];
    const to = s + 1 < starts.length ? starts[s + 1] : blocks.length;
    // Context lines: the (up to 3) non-question blocks right before this one,
    // plus the question's own first line. A block belonging to the *previous*
    // question's own body (index >= previous start) is never eligible as a
    // header for this question, no matter what it looks like — that avoids
    // leaking its options/answer/explanation/trailing prose into this unit.
    // Vignette prose lines are excluded too: they describe the case, not a
    // course title.
    const prevStart = s > 0 ? starts[s - 1] : -1;
    const ctxLines: string[] = [];
    for (let k = from - 1; k >= Math.max(0, from - 3); k--) {
      if (k > prevStart) break; // still inside the previous question's body
      if (starts.includes(k)) break;
      if (allVignetteProseIndices.has(k)) break;
      const t = texts[k];
      if (isOptionLine(t) || ANSWER_OR_EXPLANATION_LINE.test(t)) break;
      ctxLines.unshift(t);
    }
    ctxLines.push(texts[from]);
    const header = mergeHeader(docHeader, parseContextHints(ctxLines));
    // doc_intro describes the paragraph before the FIRST question only — without
    // this, mergeHeader falls through to docHeader.doc_intro for every unit (since
    // parseContextHints never sets it), leaking the same "implicit vignette" text
    // into every later question and risking false-positive case grouping.
    if (s !== 0) header.doc_intro = null;
    // Attach the vignette that explicitly covers this question start, if any.
    const owningVignette = vignettes.find((v) => v.coveredStarts.has(from));
    if (owningVignette) header.case_stem = owningVignette.text;
    // A unit's body must stop before the NEXT question's preamble. Slicing
    // straight to `to` swallows whatever sits between the two questions —
    // typically the next case's "Rotation : P3", its "Cas clinique n°2 :"
    // marker and the whole vignette — which the local parser then files as
    // this question's explanation, and which the AI sees as stray context.
    // Walk back from the next start over the run of blocks we can positively
    // identify as that preamble, stopping at the first block that belongs to
    // this question (an option, "Réponse :"/"Explication :", or explanation
    // prose we can't attribute elsewhere).
    let bodyEnd = to;
    if (s + 1 < starts.length) {
      for (let k = to - 1; k > from; k--) {
        const t = texts[k];
        if (isOptionLine(t) || ANSWER_OR_EXPLANATION_LINE.test(t)) break;
        const hints = parseContextHints([t]);
        const isNextPreamble =
          allVignetteProseIndices.has(k) ||
          isCaseMarkerLine(t) ||
          !!(hints.rotation_hint || hints.year_hint || hints.course_hint);
        if (!isNextPreamble) break;
        bodyEnd = k;
      }
    }
    const bodyBlocks = blocks.slice(from, bodyEnd);
    const text = texts.slice(from, bodyEnd).join(" ");
    units.push({ html: bodyBlocks.join("\n"), text, header });
  }
  return units;
}

/** Number of questions detected in a document (used as the expected count). */
export function countQuestions(html: string): number {
  return buildQuestionUnits(html).length;
}

/** The number each detected question declares in its own marker
 *  ("Question 7" → 7, "3." → 3), or null where the source doesn't number it. */
const LEADING_NUMBER =
  /^\s*(?:<[^>]+>\s*)*(?:Q(?:uestion)?|QCM|QCS|QROC|Cas)?\s*[N°#]?\s*(\d{1,3})\b/i;
export function questionNumbers(html: string, detectCases = true): (number | null)[] {
  return buildQuestionUnits(html, detectCases).map((u) => unitNumber(u.html));
}

/** The number one already-segmented question declares in its own marker. */
export function unitNumber(unitHtml: string): number | null {
  const first = stripTags(splitBlocks(unitHtml)[0] ?? "");
  const m = first.match(LEADING_NUMBER);
  return m ? Number(m[1]) : null;
}

/** Where the document's numbering first jumps, as "20 → 34", or null when it
 *  runs clean. Naming the break beats listing every number: the admin can go
 *  straight to that page instead of scanning a list of eighty. */
export function firstNumberingBreak(numbers: (number | null)[]): string | null {
  for (let i = 1; i < numbers.length; i++) {
    const prev = numbers[i - 1];
    const cur = numbers[i];
    if (prev == null || cur == null) return "numérotation illisible";
    if (cur !== prev + 1 && cur !== 1) return `${prev} → ${cur}`;
  }
  return null;
}

/**
 * Does the document's OWN numbering run unbroken across these questions?
 *
 * This is the one completeness signal that doesn't come from our own
 * segmentation: a chunk's `expected` count and the local parser both derive
 * from `buildQuestionUnits`, so comparing them can never reveal a question
 * that segmentation never saw. A gap in the source's numbering can
 * (1, 2, 4 → we lost 3). A restart at 1 is allowed: sections and clinical
 * cases legitimately renumber. Unnumbered questions return false — not
 * proof of a miss, but no proof of completeness either.
 */
export function numberingIsContiguous(numbers: (number | null)[]): boolean {
  if (!numbers.length || numbers.some((n) => n === null)) return false;
  const ns = numbers as number[];
  return ns.every((n, i) => i === 0 || n === ns[i - 1] + 1 || n === 1);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Group question units into chunks of `perChunk` questions. */
export function chunkUnits(
  units: QuestionUnit[],
  perChunk: number,
  colorHintFor: (chunkHtml: string) => string = () => "",
): PreparedChunk[] {
  const chunks: PreparedChunk[] = [];
  for (let i = 0; i < units.length; i += perChunk) {
    const group = units.slice(i, i + perChunk);
    const docIntro = group[0]?.header.doc_intro;
    const introBlock = docIntro ? `<p data-doc-intro="1">${escapeHtml(docIntro)}</p>\n` : "";
    const chunkHtml = introBlock + group.map((u) => u.html).join("\n");
    chunks.push({
      html: chunkHtml,
      colorHint: colorHintFor(chunkHtml),
      expected: group.length,
      contexts: group.map((u) => u.header),
      stems: group.map((u) => u.text.slice(0, 140)),
    });
  }
  return chunks;
}

// ---- re-aligning AI output onto the parsed source ---------------------------

/** Words worth matching on: 3+ chars, accents folded, punctuation dropped. */
function alignTokens(text: string): string[] {
  return stripTags(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3);
}

/** Overlap of two token lists, 0..1 (counting duplicates once). */
function tokenSimilarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setB = new Set(b);
  let hits = 0;
  for (const w of new Set(a)) if (setB.has(w)) hits++;
  return hits / Math.max(new Set(a).size, setB.size);
}

/** Below this, two stems are not considered the same question. */
const ALIGN_MIN_SIMILARITY = 0.35;

/**
 * Match each AI-returned question back to the source question it came from.
 *
 * The AI sometimes returns fewer (or more) questions than a chunk actually
 * contains. Zipping its output onto `PreparedChunk.contexts` by array index
 * then silently attaches every later question's rotation/année/cours/case_stem
 * to the wrong question. This matches on the question text instead.
 *
 * Matching is **monotonic**: a match can never point back before the previous
 * one, so the source order is always preserved. Returns one entry per AI
 * question — the source index it matched, or `null` when nothing cleared
 * `ALIGN_MIN_SIMILARITY` (caller should then keep the AI's own values rather
 * than apply a context that probably belongs to another question).
 */
export function alignByStems(aiStems: string[], sourceStems: string[]): (number | null)[] {
  const source = sourceStems.map(alignTokens);
  let cursor = 0;
  return aiStems.map((stem) => {
    const tokens = alignTokens(stem);
    let best: number | null = null;
    let bestScore = ALIGN_MIN_SIMILARITY;
    // Only look forward from the last match, so output order is preserved.
    for (let i = cursor; i < source.length; i++) {
      const score = tokenSimilarity(tokens, source[i]);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best !== null) cursor = best + 1;
    return best;
  });
}

/** Plain text → minimal HTML so PDF text can reuse the same pipeline. */
export function textToHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => `<p>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`)
    .join("\n");
}
