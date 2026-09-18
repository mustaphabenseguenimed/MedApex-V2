/**
 * Cut an over-tall page image into pieces the model can actually read.
 *
 * A screenshot export puts a whole clinical case on one "page": 1260 px wide
 * and up to 11 000 px tall. Sent as a single image, that page reaches the
 * model scaled so its longest edge fits ~1568 px — a 1260x10935 page arrives
 * as a ~180x1568 strip, where no text survives. The model then fills the gaps
 * from context: ages change, professions are invented, a vignette gets welded
 * to the previous page's, and a whole page can come back empty.
 *
 * Slicing fixes the shape rather than the size. Each piece is close enough to
 * square that the same downscale leaves the text at nearly its original width.
 */

/**
 * Tallest a slice may be, as a multiple of the page's width.
 *
 * Chosen so a band's LONGEST edge stays under the ~1568 px the model scales
 * images down to: at 1.2, a 1300 px wide band is at most 1560 px tall and
 * arrives at its native size. At the 1.6 this used to be, the same band was
 * 2080 px tall and lost a sixth of its resolution before it was even read —
 * the exact loss the slicing exists to avoid. Lower would only multiply the
 * bands without buying anything.
 */
export const MAX_SLICE_ASPECT = 1.2;

/**
 * Width, in pixels, a page's content should reach before it is read.
 *
 * Measured against this very document: every page rendered at 23% of its
 * screenshot's native width or better came back correct, and every page below
 * that — 16 to 20% — came back with invented ages and professions, or empty.
 * 1300 px puts a 1260 px wide phone capture slightly above native, with room
 * for the model's own downscale.
 */
export const TARGET_CONTENT_WIDTH = 1300;

/** Never scale past this, however small the content: a page holding one word
 *  should not be rendered as a wall. */
const MAX_RENDER_SCALE = 16;

/**
 * How much to scale a page so its content is worth reading.
 *
 * `inkWidth` is the width of the page's content in page units. A full-width
 * A4 text page lands near the scale 2 this code has always used; a capture
 * dropped into a narrow column gets the much larger scale it needs.
 */
export function contentRenderScale(
  inkWidth: number,
  target = TARGET_CONTENT_WIDTH,
  max = MAX_RENDER_SCALE,
): number {
  if (!Number.isFinite(inkWidth) || inkWidth <= 0) return 2;
  return Math.min(max, Math.max(1, target / inkWidth));
}

/** Slices overlap, so a question cut by a boundary is whole in one of them. */
const OVERLAP_RATIO = 0.08;
const MIN_OVERLAP = 120;

export type SliceRange = {
  /** Top of the slice, in page pixels. */
  top: number;
  /** Height of the slice, in page pixels. */
  height: number;
};

/**
 * Where to cut a page of `width` x `height`.
 *
 * A page already within the ratio comes back as a single range covering all of
 * it, so an ordinary document is rendered exactly as before. Ranges are
 * returned top to bottom, overlap their predecessor, and together cover the
 * page with no gap.
 */
export function sliceRanges(
  width: number,
  height: number,
  opts?: { maxAspect?: number },
): SliceRange[] {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  // Nothing usable to measure against: one range, and let the caller render
  // the page whole rather than inventing cuts from a bad number.
  if (!w || !h) return [{ top: 0, height: Math.max(0, h) }];

  const maxHeight = Math.max(1, Math.floor(w * (opts?.maxAspect ?? MAX_SLICE_ASPECT)));
  if (h <= maxHeight) return [{ top: 0, height: h }];

  const overlap = Math.min(
    Math.max(Math.round(maxHeight * OVERLAP_RATIO), MIN_OVERLAP),
    maxHeight - 1,
  );
  const step = maxHeight - overlap;
  // Spread the cuts evenly instead of leaving a sliver at the bottom: a final
  // 200 px slice holding half a question is the case this exists to avoid.
  const count = Math.max(1, Math.ceil((h - overlap) / step));
  const even = Math.ceil((h + overlap * (count - 1)) / count);

  const out: SliceRange[] = [];
  for (let i = 0; i < count; i++) {
    const top = Math.max(0, Math.min(i * (even - overlap), h - even));
    out.push({ top, height: Math.min(even, h - top) });
  }
  return out;
}

/** How many slices a page of this shape produces. */
export function sliceCount(width: number, height: number, opts?: { maxAspect?: number }): number {
  return sliceRanges(width, height, opts).length;
}

/**
 * Map each slice back to the page it came from.
 *
 * `counts[i]` is how many slices page i produced; the result is one entry per
 * slice holding that page's 0-based index. The background path stores this so
 * "p. 7" keeps meaning page 7 of the admin's file after the upload was
 * rebuilt one slice per page.
 */
export function pageMapFromCounts(counts: number[]): number[] {
  const out: number[] = [];
  counts.forEach((n, page) => {
    for (let i = 0; i < Math.max(0, n); i++) out.push(page);
  });
  return out;
}

/** The source page a slice belongs to, 1-based for display. Falls back to the
 *  slice's own position when no map was recorded. */
export function sourcePageFromMap(map: number[] | null | undefined, sliceIndex: number): number {
  const page = map?.[sliceIndex];
  return typeof page === "number" && Number.isFinite(page) ? page + 1 : sliceIndex + 1;
}

/**
 * Which extraction jobs belong to a source page that read nothing at all.
 *
 * A page whose request fails is already reported. A page whose request
 * *succeeds* and comes back with zero questions was not: the Sarcoïdose PDF
 * lost a whole clinical case and its seven questions that way, silently, and
 * the shortfall only showed up when the .docx was compared against the source
 * by hand. Since a page is now several slices, the verdict is per page — one
 * empty slice among five is normal, all five empty is not.
 *
 * Returns the job indices to re-run, so they can join the ones that errored in
 * the existing "Réessayer ces pages" card.
 */
export function jobsOfEmptyPages(
  jobs: { fileIndex: number; pageIndex: number }[],
  questionCounts: (number | null | undefined)[],
): number[] {
  const total = new Map<string, number>();
  const key = (j: { fileIndex: number; pageIndex: number }) => `${j.fileIndex}:${j.pageIndex}`;
  jobs.forEach((job, i) => {
    total.set(key(job), (total.get(key(job)) ?? 0) + (questionCounts[i] ?? 0));
  });
  return jobs.map((_, i) => i).filter((i) => (total.get(key(jobs[i])) ?? 0) === 0);
}

/**
 * Drop a question that came back twice from neighbouring reads.
 *
 * Two mechanisms produce the same question twice. Slices overlap on purpose,
 * so a question sitting on a cut is whole in both pieces. And each slice is
 * sent with the one before it as context: the model is told to read only the
 * second image, but it sometimes extracts from the context too — and when that
 * context is the last slice of the PREVIOUS page, the copy comes back stamped
 * with the new page.
 *
 * So the comparison spans a page boundary, but only one: a revision paper can
 * legitimately ask the same question on page 3 and again on page 14, and
 * merging those would lose a real question. Neither mechanism can reach
 * further than one page.
 *
 * Order is preserved and the FIRST copy is the one kept, so a question stays
 * where the document puts it.
 */
export function dropSliceDuplicates<
  T extends { stem?: string | null; choices?: string[] | null; source_page?: number | null },
>(questions: T[]): T[] {
  /** Pages on which each distinct question has already been kept. */
  const seen = new Map<string, number[]>();
  const norm = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      // The paper's own question number. The overlap hands the same question
      // back once with it ("16. Résultats des examens…") and once without,
      // which is enough to make two identical questions look different.
      .replace(/^\s*\d{1,3}\s*[.)\-:]\s+/, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();
  return questions.filter((q) => {
    const stem = norm(q.stem ?? "");
    // Nothing to compare on: never drop it. A blank stem is a problem to
    // show the admin, not a duplicate to hide.
    if (!stem) return true;
    const key = [stem, (q.choices ?? []).map(norm).join("|")].join("\u0000");
    // An unstamped question still dedupes against other unstamped ones: page 0
    // for all of them puts every copy within reach of every other.
    const page = typeof q.source_page === "number" ? q.source_page : 0;
    const kept = seen.get(key);
    if (!kept) {
      seen.set(key, [page]);
      return true;
    }
    if (kept.some((p) => Math.abs(p - page) <= 1)) return false;
    kept.push(page);
    return true;
  });
}

/**
 * How hard to try on a page that came back with nothing.
 *
 * Re-sending the same image is pointless — the model already read it and found
 * nothing — so a retry renders the page again, cut finer.
 *
 * Finer at the SAME width, never wider. A page now travels as one request, so
 * its bands share one budget: asking for wider bands only spends that budget
 * on more pixels and the quality collapses to fit, which made a retry deliver
 * a blurrier page than the first attempt. Shorter bands at the same width keep
 * the pixel count steady and stay further inside the model's own size cap.
 *
 * The steps are deliberately few: past a point the page is genuinely illegible
 * and the honest answer is to say so rather than keep spending model calls.
 *
 * Attempt 0 is the ordinary setting, so a page that merely lost its request to
 * the network is re-sent exactly as it was built.
 */
const ESCALATION: { targetWidth: number; maxAspect: number }[] = [
  { targetWidth: TARGET_CONTENT_WIDTH, maxAspect: MAX_SLICE_ASPECT },
  { targetWidth: TARGET_CONTENT_WIDTH, maxAspect: 1.0 },
  { targetWidth: TARGET_CONTENT_WIDTH, maxAspect: 0.85 },
];

/** Number of attempts available, the first being the ordinary render. */
export const ESCALATION_STEPS = ESCALATION.length;

/** Settings for the nth attempt at a page. Clamped, so a caller that loses
 *  count gets the hardest try rather than an exception. */
export function escalationStep(attempt: number): { targetWidth: number; maxAspect: number } {
  const i = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return ESCALATION[Math.min(i, ESCALATION.length - 1)];
}

/** Is there a harder setting left to try on this page? */
export function canEscalate(attempt: number): boolean {
  return Number.isFinite(attempt) && attempt < ESCALATION.length - 1;
}

/**
 * Swap the entries of certain source pages for new ones, keeping order.
 *
 * A page re-rendered harder produces a different number of slices, so its
 * entries cannot simply be overwritten in place. The replacements land where
 * the page's first old entry was, and the page's other old entries drop out —
 * which keeps the document reading in page order however the cuts changed.
 */
export function replacePageEntries<T extends { fileIndex: number; pageIndex: number }>(
  entries: T[],
  replacements: Map<string, T[]>,
): T[] {
  const key = (e: { fileIndex: number; pageIndex: number }) => `${e.fileIndex}:${e.pageIndex}`;
  const used = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    const k = key(entry);
    const replacement = replacements.get(k);
    if (!replacement) {
      out.push(entry);
      continue;
    }
    if (used.has(k)) continue;
    used.add(k);
    out.push(...replacement);
  }
  return out;
}

/**
 * Settings to try, in order, until a whole page's strips fit their budget.
 *
 * A page travels as one request now, so what has to fit is the page rather
 * than the strip. Quality gives way before scale, because shrinking is what
 * costs legibility and legibility is the point of rendering this way at all.
 * The cuts never move — those are geometry — so stepping down this ladder
 * never changes how many strips a page has.
 */
export const PAGE_QUALITY_LADDER: readonly { factor: number; quality: number }[] = [
  { factor: 1, quality: 0.9 },
  { factor: 1, quality: 0.8 },
  { factor: 1, quality: 0.65 },
  { factor: 0.85, quality: 0.75 },
  { factor: 0.85, quality: 0.6 },
  { factor: 0.7, quality: 0.7 },
  { factor: 0.7, quality: 0.55 },
];

/** Do these strips, together, fit what one request may carry? */
export function stripsFitBudget(strips: string[], maxPageBytes: number): boolean {
  return strips.reduce((n, s) => n + s.length, 0) <= maxPageBytes;
}
