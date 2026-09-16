import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  contentRenderScale,
  dropSliceDuplicates,
  jobsOfEmptyPages,
  MAX_SLICE_ASPECT,
  TARGET_CONTENT_WIDTH,
  pageMapFromCounts,
  sliceCount,
  sliceRanges,
  sourcePageFromMap,
} from "./pdfSlices";

/** Do the ranges cover [0, height) with no gap, in order? */
function covers(ranges: { top: number; height: number }[], height: number): boolean {
  if (ranges[0].top !== 0) return false;
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].top > ranges[i - 1].top + ranges[i - 1].height) return false;
    if (ranges[i].top <= ranges[i - 1].top) return false;
  }
  const last = ranges[ranges.length - 1];
  return last.top + last.height === height;
}

describe("sliceRanges", () => {
  test("an ordinary page is not cut at all", () => {
    // A4 at 150dpi: well inside the ratio, so rendering is unchanged.
    assert.deepEqual(sliceRanges(1240, 1754), [{ top: 0, height: 1754 }]);
    assert.equal(sliceCount(1240, 1754), 1);
  });

  test("a page exactly at the limit is still one slice", () => {
    const w = 1000;
    assert.equal(sliceCount(w, Math.floor(w * MAX_SLICE_ASPECT)), 1);
    assert.equal(sliceCount(w, Math.floor(w * MAX_SLICE_ASPECT) + 1), 2);
  });

  // The page this whole change exists for: one clinical case, 7 questions,
  // 1260x10935 — as one image it reaches the model as an unreadable strip.
  test("the tallest real page is cut into readable pieces that cover it", () => {
    const ranges = sliceRanges(1260, 10935);
    assert.ok(ranges.length >= 5, `expected several slices, got ${ranges.length}`);
    assert.ok(covers(ranges, 10935), "slices must cover the page in order with no gap");
    for (const r of ranges) {
      assert.ok(
        r.height <= 1260 * MAX_SLICE_ASPECT + 1,
        `slice of ${r.height}px is taller than the budget`,
      );
      assert.ok(r.top >= 0 && r.top + r.height <= 10935, "slice must stay on the page");
    }
  });

  test("consecutive slices overlap, so a question cut by a boundary survives whole", () => {
    const ranges = sliceRanges(1260, 10935);
    for (let i = 1; i < ranges.length; i++) {
      const overlap = ranges[i - 1].top + ranges[i - 1].height - ranges[i].top;
      assert.ok(overlap >= 100, `slices ${i - 1}/${i} overlap by only ${overlap}px`);
    }
  });

  test("the slices come out evenly, with no sliver at the bottom", () => {
    const ranges = sliceRanges(1260, 10935);
    const heights = ranges.map((r) => r.height);
    assert.ok(
      Math.max(...heights) - Math.min(...heights) <= 2,
      `uneven slices: ${heights.join(", ")}`,
    );
  });

  test("a page just over the limit splits in two, not into a sliver", () => {
    const ranges = sliceRanges(1000, 1700);
    assert.equal(ranges.length, 2);
    assert.ok(covers(ranges, 1700));
    assert.ok(Math.abs(ranges[0].height - ranges[1].height) <= 2);
  });

  test("an unusable size degrades to one range instead of inventing cuts", () => {
    assert.deepEqual(sliceRanges(0, 5000), [{ top: 0, height: 5000 }]);
    assert.deepEqual(sliceRanges(1260, 0), [{ top: 0, height: 0 }]);
    assert.deepEqual(sliceRanges(Number.NaN, Number.NaN), [{ top: 0, height: 0 }]);
  });
});

describe("page map", () => {
  test("names the source page of every slice", () => {
    // Pages 1 and 3 were cut in two and three; page 2 was left whole.
    assert.deepEqual(pageMapFromCounts([2, 1, 3]), [0, 0, 1, 2, 2, 2]);
  });

  test("reads a slice back to its page, 1-based for display", () => {
    const map = pageMapFromCounts([2, 1, 3]);
    assert.equal(sourcePageFromMap(map, 0), 1);
    assert.equal(sourcePageFromMap(map, 1), 1);
    assert.equal(sourcePageFromMap(map, 2), 2);
    assert.equal(sourcePageFromMap(map, 5), 3);
  });

  // A job created before any slicing has no map, and its pages are its pages.
  test("with no map a slice is its own page", () => {
    assert.equal(sourcePageFromMap(null, 6), 7);
    assert.equal(sourcePageFromMap(undefined, 0), 1);
    assert.equal(sourcePageFromMap([], 3), 4);
  });

  test("an empty count list maps nothing", () => {
    assert.deepEqual(pageMapFromCounts([]), []);
    assert.deepEqual(pageMapFromCounts([0, 2]), [1, 1]);
  });
});

describe("dropSliceDuplicates", () => {
  const q = (stem: string, source_page: number, choices = ["a", "b"]) => ({
    stem,
    choices,
    source_page,
  });

  // The cost of overlapping the slices: a question sitting on a cut is whole
  // in both pieces, so both extractions return it.
  test("a question the overlap returned twice is kept once, in its place", () => {
    const out = dropSliceDuplicates([
      q("Quel diagnostic ?", 3),
      q("Quels examens ?", 3),
      q("Quels examens ?", 3),
      q("Quel traitement ?", 3),
    ]);
    assert.deepEqual(
      out.map((x) => x.stem),
      ["Quel diagnostic ?", "Quels examens ?", "Quel traitement ?"],
    );
  });

  test("the same wording on two different pages is two real questions", () => {
    const out = dropSliceDuplicates([q("Quel diagnostic ?", 3), q("Quel diagnostic ?", 7)]);
    assert.equal(out.length, 2);
  });

  test("the same stem with different options is not a duplicate", () => {
    const out = dropSliceDuplicates([
      q("Votre conduite ?", 2, ["Corticoïdes", "Antibiotiques"]),
      q("Votre conduite ?", 2, ["Oxygène", "Diurétiques"]),
    ]);
    assert.equal(out.length, 2);
  });

  test("markup and spacing differences do not hide a duplicate", () => {
    const out = dropSliceDuplicates([
      q("<p>Quel <strong>diagnostic</strong> ?</p>", 1),
      q("Quel diagnostic  ?", 1),
    ]);
    assert.equal(out.length, 1);
  });

  test("a question with no stem is never silently dropped", () => {
    const out = dropSliceDuplicates([q("", 1), q("", 1)]);
    assert.equal(out.length, 2, "an empty stem is a problem to show, not a duplicate to hide");
  });

  test("an unstamped list still dedupes within itself", () => {
    const out = dropSliceDuplicates([{ stem: "A ?" }, { stem: "A ?" }, { stem: "B ?" }]);
    assert.equal(out.length, 2);
  });
});

describe("jobsOfEmptyPages", () => {
  const job = (fileIndex: number, pageIndex: number) => ({ fileIndex, pageIndex });

  // The failure this exists for: page 14 was read without error and returned
  // nothing, and the whole clinical case vanished without a word.
  test("names every slice of a page that read nothing", () => {
    const jobs = [job(0, 0), job(0, 1), job(0, 1), job(0, 2)];
    assert.deepEqual(jobsOfEmptyPages(jobs, [3, 0, 0, 5]), [1, 2]);
  });

  test("one empty slice among several is normal", () => {
    const jobs = [job(0, 0), job(0, 0), job(0, 0)];
    assert.deepEqual(jobsOfEmptyPages(jobs, [0, 4, 0]), []);
  });

  test("a failed request counts as nothing read", () => {
    assert.deepEqual(jobsOfEmptyPages([job(0, 0), job(0, 1)], [null, 2]), [0]);
    assert.deepEqual(jobsOfEmptyPages([job(0, 0)], [undefined]), [0]);
  });

  test("pages of different files are counted apart", () => {
    const jobs = [job(0, 0), job(1, 0)];
    assert.deepEqual(jobsOfEmptyPages(jobs, [2, 0]), [1]);
  });

  test("nothing to check is nothing to report", () => {
    assert.deepEqual(jobsOfEmptyPages([], []), []);
  });
});

describe("contentRenderScale", () => {
  // The measurement this constant comes from: in the Sarcoïdose PDF every
  // page rendered at 23% of its screenshot's native width or better came back
  // correct, and every page at 16-20% came back invented or empty.
  test("a capture squeezed into a narrow column is scaled up hard", () => {
    // Page 8: a 1260px screenshot drawn 100pt wide on an A4 sheet.
    assert.equal(contentRenderScale(100), 13);
    // Page 2 and 6 were the other two that failed.
    assert.ok(contentRenderScale(109.5) > 11);
  });

  test("a normal full-width page lands near the scale used all along", () => {
    const scale = contentRenderScale(500);
    assert.ok(scale > 2 && scale < 3, `expected ~2.6, got ${scale}`);
  });

  test("content already wider than the target is never shrunk", () => {
    assert.equal(contentRenderScale(TARGET_CONTENT_WIDTH * 2), 1);
    assert.equal(contentRenderScale(TARGET_CONTENT_WIDTH), 1);
  });

  test("a page holding almost nothing is not blown up without limit", () => {
    assert.equal(contentRenderScale(1), 16);
    assert.equal(contentRenderScale(0.001), 16);
  });

  test("an unusable measurement falls back to the old fixed scale", () => {
    assert.equal(contentRenderScale(0), 2);
    assert.equal(contentRenderScale(-5), 2);
    assert.equal(contentRenderScale(Number.NaN), 2);
  });

  // The two work together: scale first, then cut what is now very tall.
  test("scaling then slicing turns a narrow strip into readable pieces", () => {
    const inkWidth = 100;
    const inkHeight = 842;
    const scale = contentRenderScale(inkWidth);
    const ranges = sliceRanges(inkWidth * scale, inkHeight * scale);
    assert.ok(ranges.length >= 5, `expected several slices, got ${ranges.length}`);
    for (const r of ranges) {
      assert.ok(r.height <= inkWidth * scale * MAX_SLICE_ASPECT + 1);
    }
  });

  test("a normal page still comes out as a single image", () => {
    const scale = contentRenderScale(500);
    assert.equal(sliceRanges(500 * scale, 780 * scale).length, 1);
  });
});
