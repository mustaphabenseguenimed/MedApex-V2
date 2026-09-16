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
 * At 1.6 a 1260-wide page slices at ~2000 px, so after the model's longest-edge
 * cap the delivered width is still ~1000 px — the size at which this PDF was
 * legible when read by hand. Higher loses text; lower multiplies the requests.
 */
export const MAX_SLICE_ASPECT = 1.6;

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
 * Drop a question the overlap between two slices handed in twice.
 *
 * Slices overlap on purpose, so a question sitting on a cut is whole in both
 * pieces — and both extractions return it. Only within one source page: two
 * pages of a revision paper can legitimately ask the same thing, and merging
 * those would lose a real question.
 *
 * Order is preserved and the FIRST copy is the one kept, so a question stays
 * where the document puts it.
 */
export function dropSliceDuplicates<
  T extends { stem?: string | null; choices?: string[] | null; source_page?: number | null },
>(questions: T[]): T[] {
  const seen = new Set<string>();
  const norm = (s: string) =>
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .toLowerCase();
  return questions.filter((q) => {
    const stem = norm(q.stem ?? "");
    // Nothing to compare on: never drop it. A blank stem is a problem to
    // show the admin, not a duplicate to hide.
    if (!stem) return true;
    const key = [q.source_page ?? "?", stem, (q.choices ?? []).map(norm).join("|")].join("\u0000");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
