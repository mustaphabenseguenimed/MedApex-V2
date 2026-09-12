/**
 * Parsing for the web-grounded answer check in Step 2.
 *
 * Lives apart from `conversion.functions.ts` so it stays a pure function with
 * no server-only imports: this is the one piece of that feature whose failure
 * mode is silent (a misparsed line would rewrite a correct answer key), so it
 * needs to be testable on its own. See `answerVerdicts.test.ts`.
 */

/** One question's verdict from the web-grounded second opinion. */
export type AnswerVerdict = {
  index: number;
  /** 0-based indices the grounded pass settled on, or null when it declined
   *  to call it (which leaves the recorded answer alone). */
  final_indices: number[] | null;
  confidence: "high" | "medium" | "low";
  why: string;
};

/**
 * Parse the grounded pass's line format:
 *   `[3] FINAL=B CONF=high WHY=la thrombolyse est contre-indiquée ici`
 *
 * Deliberately forgiving about surroundings (the model wraps lines in prose,
 * bullets or backticks) and deliberately strict about the payload: anything
 * it cannot read is skipped rather than guessed at. `FINAL=-` means "no call".
 *
 * @param optionCount how many options question `index` has — letters beyond
 *   that are treated as a misread line, not as "none of the above".
 */
export function parseAnswerVerdicts(
  text: string,
  optionCount: (index: number) => number,
): AnswerVerdict[] {
  const verdicts: AnswerVerdict[] = [];

  // One line at a time, one field at a time. A single combined regex reads
  // the neighbouring key as answer letters — "FINAL=B CONF=high" parses as
  // B and C — so the letter run must never cross a space: letters are either
  // adjacent ("AC") or joined by a real separator ("A, C").
  for (const line of text.split(/\r?\n/)) {
    const idx = line.match(/\[(\d{1,3})\]/);
    if (!idx) continue;
    const index = Number(idx[1]);
    if (!Number.isInteger(index) || index < 0) continue;

    const final = line.match(/FINAL\s*=\s*(-|[A-Za-z](?:\s*[,;+/]\s*[A-Za-z]|[A-Za-z])*)/i);
    if (!final) continue;

    const confidence =
      (line.match(/CONF\s*=\s*(high|medium|low)/i)?.[1].toLowerCase() as
        AnswerVerdict["confidence"] | undefined) ?? "low";
    // Trailing markdown the model wrapped the line in is not part of the reason.
    const why = (line.match(/WHY\s*=\s*(.*)$/i)?.[1] ?? "")
      .trim()
      .replace(/[`*_]+$/, "")
      .trim();

    const rawFinal = final[1].trim();
    if (rawFinal === "-") {
      verdicts.push({ index, final_indices: null, confidence, why });
      continue;
    }

    const count = optionCount(index);
    const letters = rawFinal.toUpperCase().match(/[A-Z]/g) ?? [];
    const indices = [...new Set(letters.map((l) => l.charCodeAt(0) - 65))]
      .filter((n) => n >= 0 && n < count)
      .sort((a, b) => a - b);
    // Every letter out of range means we misread the line, not that the
    // answer is "none of them" — drop it rather than blank the key.
    if (!indices.length) continue;
    verdicts.push({ index, final_indices: indices, confidence, why });
  }
  return verdicts;
}

/** Do two answer keys differ? Order- and null-insensitive. */
export function sameAnswer(
  a: number[] | null | undefined,
  b: number[] | null | undefined,
): boolean {
  const norm = (x: number[] | null | undefined) => [...new Set(x ?? [])].sort((m, n) => m - n);
  const na = norm(a);
  const nb = norm(b);
  return na.length === nb.length && na.every((v, i) => v === nb[i]);
}

/** "A", "AC", or "?" for an empty key — how answers are shown to the admin. */
export function answerLetters(idx: number[] | null | undefined): string {
  return idx && idx.length ? idx.map((k) => String.fromCharCode(65 + k)).join("") : "?";
}
