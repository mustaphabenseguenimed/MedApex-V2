import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  canEscalate,
  contentRenderScale,
  ESCALATION_STEPS,
  escalationStep,
  dropSliceDuplicates,
  jobsOfEmptyPages,
  replacePageEntries,
  MAX_SLICE_ASPECT,
  PAGE_QUALITY_LADDER,
  stripsFitBudget,
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

  test("the same wording on two distant pages is two real questions", () => {
    const out = dropSliceDuplicates([q("Quel diagnostic ?", 3), q("Quel diagnostic ?", 7)]);
    assert.equal(out.length, 2, "a revision paper may ask the same thing twice");
  });

  // Each slice carries the one before it as context. The model is told to read
  // only the second image and sometimes reads both — so when the context is
  // the last slice of the PREVIOUS page, the question comes back stamped with
  // the new page. Eleven of the twelve duplicates in the real run were this.
  test("a question the context image returned again on the next page is one", () => {
    const out = dropSliceDuplicates([
      q("Interprétez la gazométrie ?", 8),
      q("Interprétez la gazométrie ?", 9),
    ]);
    assert.equal(out.length, 1);
    assert.equal(out[0].source_page, 8, "the first copy, so it stays where the document puts it");
  });

  test("but it never reaches two pages away", () => {
    const out = dropSliceDuplicates([q("Quel diagnostic ?", 3), q("Quel diagnostic ?", 5)]);
    assert.equal(out.length, 2);
  });

  // Three copies in a row (overlap plus context) still leave one, and a
  // genuine repeat further on is still kept.
  test("a run of copies collapses to one without swallowing a distant repeat", () => {
    const out = dropSliceDuplicates([
      q("Votre conduite ?", 4),
      q("Votre conduite ?", 4),
      q("Votre conduite ?", 5),
      q("Votre conduite ?", 12),
    ]);
    assert.deepEqual(
      out.map((x) => x.source_page),
      [4, 12],
    );
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

  // The paper numbers its own questions, and the overlap returns the same one
  // once with that number and once without.
  test("the paper's own question number does not make it a new question", () => {
    const out = dropSliceDuplicates([
      q("16. Résultats des examens demandés : TDM6 interrompu.", 5),
      q("Résultats des examens demandés : TDM6 interrompu.", 5),
    ]);
    assert.equal(out.length, 1);
    assert.equal(
      out[0].stem,
      "16. Résultats des examens demandés : TDM6 interrompu.",
      "first kept",
    );
  });

  test("a number that belongs to the question itself is not stripped away", () => {
    // No separator-plus-space after it, so it reads as part of the sentence.
    const out = dropSliceDuplicates([
      q("20 patients ont été inclus.", 1),
      q("patients ont été inclus.", 1),
    ]);
    assert.equal(out.length, 2);
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

describe("escalation", () => {
  // Re-sending an image the model already read and found nothing in achieves
  // nothing. A retry has to change the input, or it is only spending calls.
  test("the first attempt is the ordinary render", () => {
    assert.deepEqual(escalationStep(0), {
      targetWidth: TARGET_CONTENT_WIDTH,
      maxAspect: MAX_SLICE_ASPECT,
    });
  });

  test("each step renders larger and cuts finer", () => {
    for (let i = 1; i < ESCALATION_STEPS; i++) {
      const prev = escalationStep(i - 1);
      const next = escalationStep(i);
      assert.ok(next.targetWidth > prev.targetWidth, `step ${i} is not larger`);
      assert.ok(next.maxAspect < prev.maxAspect, `step ${i} is not cut finer`);
    }
  });

  // The point of a finite ladder: the UI can stop offering a button that
  // cannot help, and say the page is illegible instead.
  test("the ladder ends, so a hopeless page is eventually called hopeless", () => {
    assert.ok(ESCALATION_STEPS >= 2 && ESCALATION_STEPS <= 4);
    assert.equal(canEscalate(0), true);
    assert.equal(canEscalate(ESCALATION_STEPS - 1), false);
    assert.equal(canEscalate(ESCALATION_STEPS), false);
  });

  test("losing count gives the hardest try, never an exception", () => {
    assert.deepEqual(escalationStep(99), escalationStep(ESCALATION_STEPS - 1));
    assert.deepEqual(escalationStep(-1), escalationStep(0));
    assert.deepEqual(escalationStep(Number.NaN), escalationStep(0));
    assert.equal(canEscalate(Number.NaN), false);
  });

  // Escalating has to actually change what the page is cut into, or the
  // retry is the same no-op by another route.
  test("escalating a real page yields more, larger pieces", () => {
    const inkWidth = 100;
    const inkHeight = 842;
    const counts = [0, 1, 2].map((attempt) => {
      const step = escalationStep(attempt);
      const scale = contentRenderScale(inkWidth, step.targetWidth);
      return sliceRanges(inkWidth * scale, inkHeight * scale, {
        maxAspect: step.maxAspect,
      }).length;
    });
    assert.ok(counts[1] > counts[0], `step 1 did not cut finer: ${counts.join(", ")}`);
    assert.ok(counts[2] > counts[1], `step 2 did not cut finer: ${counts.join(", ")}`);
  });
});

describe("replacePageEntries", () => {
  const e = (fileIndex: number, pageIndex: number, tag: string) => ({ fileIndex, pageIndex, tag });

  // A page re-rendered harder yields a different number of slices, so its
  // entries cannot be overwritten one for one.
  test("a page's slices are swapped in place, however their count changed", () => {
    const entries = [e(0, 0, "a"), e(0, 1, "b1"), e(0, 1, "b2"), e(0, 2, "c")];
    const out = replacePageEntries(
      entries,
      new Map([["0:1", [e(0, 1, "new1"), e(0, 1, "new2"), e(0, 1, "new3")]]]),
    );
    assert.deepEqual(
      out.map((x) => x.tag),
      ["a", "new1", "new2", "new3", "c"],
      "the page keeps its place in the document",
    );
  });

  test("fewer slices than before is just as fine", () => {
    const entries = [e(0, 0, "a1"), e(0, 0, "a2"), e(0, 0, "a3"), e(0, 1, "b")];
    const out = replacePageEntries(entries, new Map([["0:0", [e(0, 0, "only")]]]));
    assert.deepEqual(
      out.map((x) => x.tag),
      ["only", "b"],
    );
  });

  test("pages of another file with the same number are untouched", () => {
    const entries = [e(0, 1, "f0"), e(1, 1, "f1")];
    const out = replacePageEntries(entries, new Map([["1:1", [e(1, 1, "new")]]]));
    assert.deepEqual(
      out.map((x) => x.tag),
      ["f0", "new"],
    );
  });

  test("replacing several pages at once keeps them all in order", () => {
    const entries = [e(0, 0, "a"), e(0, 1, "b"), e(0, 2, "c")];
    const out = replacePageEntries(
      entries,
      new Map([
        ["0:0", [e(0, 0, "A1"), e(0, 0, "A2")]],
        ["0:2", [e(0, 2, "C1")]],
      ]),
    );
    assert.deepEqual(
      out.map((x) => x.tag),
      ["A1", "A2", "b", "C1"],
    );
  });

  test("nothing to replace leaves the list exactly as it was", () => {
    const entries = [e(0, 0, "a"), e(0, 1, "b")];
    assert.deepEqual(replacePageEntries(entries, new Map()), entries);
    assert.deepEqual(replacePageEntries([], new Map([["0:0", [e(0, 0, "x")]]])), []);
  });
});

describe("page budget", () => {
  const strip = (bytes: number) => "x".repeat(bytes);

  test("a page is measured whole, not strip by strip", () => {
    // Six strips that each fit comfortably but together do not.
    const page = Array.from({ length: 6 }, () => strip(600_000));
    assert.equal(stripsFitBudget(page, 3_000_000), false);
    assert.equal(stripsFitBudget(page, 4_000_000), true);
  });

  test("a page already inside the budget is left alone", () => {
    assert.equal(stripsFitBudget([strip(100)], 3_000_000), true);
    assert.equal(stripsFitBudget([], 3_000_000), true, "nothing always fits");
  });

  test("exactly at the budget still fits", () => {
    assert.equal(stripsFitBudget([strip(1000), strip(1000)], 2000), true);
    assert.equal(stripsFitBudget([strip(1000), strip(1001)], 2000), false);
  });
});

describe("PAGE_QUALITY_LADDER", () => {
  test("starts at full scale and the best quality", () => {
    assert.deepEqual(PAGE_QUALITY_LADDER[0], { factor: 1, quality: 0.9 });
  });

  // Shrinking is what costs legibility, so every quality step at a given scale
  // must be spent before the scale is reduced.
  test("gives up quality before it gives up scale", () => {
    for (let i = 1; i < PAGE_QUALITY_LADDER.length; i++) {
      const prev = PAGE_QUALITY_LADDER[i - 1];
      const next = PAGE_QUALITY_LADDER[i];
      assert.ok(next.factor <= prev.factor, `step ${i} scaled back up`);
      if (next.factor === prev.factor) {
        assert.ok(next.quality < prev.quality, `step ${i} at the same scale did not step down`);
      }
    }
  });

  test("every setting is usable", () => {
    for (const { factor, quality } of PAGE_QUALITY_LADDER) {
      assert.ok(factor > 0 && factor <= 1, `bad factor ${factor}`);
      assert.ok(quality > 0 && quality <= 1, `bad quality ${quality}`);
    }
    assert.ok(PAGE_QUALITY_LADDER.length >= 3, "too few steps to recover a heavy page");
  });
});
