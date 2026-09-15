import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { ExtractedQ } from "./questions.functions";
import {
  applyPage,
  canCancel,
  isTerminal,
  flattenQuestions,
  JOB_DEADLINE_MARGIN_MS,
  leaseExpired,
  pageWarnings,
  pagesToProcess,
  shouldStopForDeadline,
  sourcePageOf,
  statusAfterPass,
  withSourcePage,
  type JobPage,
} from "./conversionJobs";

const q = (stem: string): ExtractedQ => ({
  type: "qcs",
  stem,
  choices: ["a", "b"],
  correct_indices: [0],
  model_answer: null,
  explanation: null,
});
const page = (index: number, stems: string[], warning?: string): JobPage => ({
  index,
  questions: stems.map(q),
  ...(warning ? { warning } : {}),
});

describe("pagesToProcess", () => {
  test("a fresh job does every page", () => {
    assert.deepEqual(pagesToProcess(3, [], []), [0, 1, 2]);
  });

  // The case this exists for: an invocation died halfway and the next call
  // has to continue rather than start over.
  test("a resumed job only does what is left", () => {
    assert.deepEqual(pagesToProcess(5, [page(0, ["a"]), page(1, ["b"])], []), [2, 3, 4]);
  });

  test("a page that failed is tried again, in its place in the document", () => {
    const pages = [page(0, ["a"]), page(1, []), page(2, ["c"])];
    assert.deepEqual(pagesToProcess(4, pages, [1]), [1, 3]);
  });

  test("nothing left is nothing to do", () => {
    assert.deepEqual(pagesToProcess(2, [page(0, ["a"]), page(1, ["b"])], []), []);
    assert.deepEqual(pagesToProcess(0, [], []), []);
  });
});

describe("applyPage", () => {
  test("keeps the pages in document order whatever order they arrive in", () => {
    let pages: JobPage[] = [];
    pages = applyPage(pages, page(2, ["c"]));
    pages = applyPage(pages, page(0, ["a"]));
    pages = applyPage(pages, page(1, ["b"]));
    assert.deepEqual(
      pages.map((p) => p.index),
      [0, 1, 2],
    );
  });

  test("a retried page replaces its earlier result, it does not duplicate it", () => {
    const pages = applyPage([page(0, ["a"]), page(1, [])], page(1, ["b"]));
    assert.equal(pages.length, 2);
    assert.deepEqual(
      flattenQuestions(pages).map((x) => x.stem),
      ["a", "b"],
    );
  });
});

describe("flattenQuestions", () => {
  // A page retried late must not put its questions at the end of the file.
  test("returns the questions in the document's order, not the order they came back", () => {
    const pages = [page(2, ["c"]), page(0, ["a"]), page(1, ["b"])];
    assert.deepEqual(
      flattenQuestions(pages).map((x) => x.stem),
      ["a", "b", "c"],
    );
  });

  test("empty pages contribute nothing", () => {
    assert.deepEqual(flattenQuestions([]), []);
    assert.deepEqual(flattenQuestions([page(0, [])]), []);
  });

  // The whole point of the stamp: a question can be traced back to its page,
  // so "the cases came out in the wrong order" can be read off the preview
  // instead of guessed at.
  test("stamps each question with the page it was read from", () => {
    const pages = [page(0, ["a", "b"]), page(2, ["c"])];
    assert.deepEqual(
      flattenQuestions(pages).map((x) => [x.stem, x.source_page]),
      [
        ["a", 1],
        ["b", 1],
        ["c", 3],
      ],
    );
  });

  // A page retried after the ones behind it comes back last but belongs in
  // its own place — and has to keep its own number there.
  test("the page number follows the question when a late page is folded in", () => {
    let pages: JobPage[] = [page(0, ["a"]), page(1, [])];
    pages = applyPage(pages, page(2, ["c"]));
    pages = applyPage(pages, page(1, ["b"]));
    assert.deepEqual(
      flattenQuestions(pages).map((x) => [x.stem, x.source_page]),
      [
        ["a", 1],
        ["b", 2],
        ["c", 3],
      ],
    );
  });
});

describe("source page", () => {
  test("reads the stamp back off a question", () => {
    assert.equal(sourcePageOf(withSourcePage(q("a"), 7)), 7);
  });

  // Steps 2 to 4 hand around questions that were never stamped (a .docx read
  // back, an edited list); the badge simply has nothing to show for those.
  test("a question with no stamp has no page", () => {
    assert.equal(sourcePageOf(q("a")), null);
    assert.equal(sourcePageOf(null), null);
    assert.equal(sourcePageOf(undefined), null);
    assert.equal(sourcePageOf({ source_page: "3" }), null);
    assert.equal(sourcePageOf({ source_page: Number.NaN }), null);
  });

  test("stamping leaves the original question untouched", () => {
    const original = q("a");
    const stamped = withSourcePage(original, 4);
    assert.equal(sourcePageOf(original), null);
    assert.equal(stamped.stem, "a");
  });
});

describe("pageWarnings", () => {
  test("names the page each note came from", () => {
    const pages = [page(0, ["a"]), page(1, ["b"], "4 détectée(s), 2 extraite(s)")];
    assert.deepEqual(pageWarnings(pages, "exam.pdf"), [
      { filename: "exam.pdf (p2)", warning: "4 détectée(s), 2 extraite(s)" },
    ]);
  });

  test("a clean run has nothing to say", () => {
    assert.deepEqual(pageWarnings([page(0, ["a"])], "exam.pdf"), []);
  });
});

describe("leaseExpired", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  test("a job nobody has claimed is free", () => {
    assert.equal(leaseExpired(null, now), true);
    assert.equal(leaseExpired(undefined, now), true);
  });

  test("a live lease is respected", () => {
    assert.equal(leaseExpired("2026-09-14T12:02:00Z", now), false);
  });

  // A worker killed mid-invocation never releases its lease; the job has to
  // become claimable again on its own.
  test("a dead worker's lease frees the job", () => {
    assert.equal(leaseExpired("2026-09-14T11:59:00Z", now), true);
    assert.equal(leaseExpired("2026-09-14T12:00:00Z", now), true, "exactly expired counts");
  });

  test("an unreadable lease never blocks the job", () => {
    assert.equal(leaseExpired("not a date", now), true);
  });
});

describe("shouldStopForDeadline", () => {
  const now = Date.parse("2026-09-14T12:00:00Z");

  test("stops when the next page cannot finish in time", () => {
    const deadline = now + 40_000;
    assert.equal(shouldStopForDeadline(deadline, 30_000, now), true);
  });

  test("keeps going while there is room for another page plus the final write", () => {
    const deadline = now + 120_000;
    assert.equal(shouldStopForDeadline(deadline, 30_000, now), false);
  });

  test("leaves the margin the status write needs", () => {
    const deadline = now + JOB_DEADLINE_MARGIN_MS + 10_000;
    assert.equal(shouldStopForDeadline(deadline, 10_000, now), true, "exactly out of room");
    assert.equal(shouldStopForDeadline(deadline + 1, 10_000, now), false);
  });
});

describe("statusAfterPass", () => {
  test("every page read means done", () => {
    assert.equal(statusAfterPass(2, [page(0, ["a"]), page(1, ["b"])], [], true), "done");
  });

  test("pages left and progress made means another pass", () => {
    assert.equal(statusAfterPass(3, [page(0, ["a"])], [], true), "running");
    assert.equal(statusAfterPass(2, [page(0, ["a"]), page(1, [])], [1], true), "running");
  });

  // The watcher starts a pass whenever the job says "running", so a pass that
  // read nothing has to end the job — otherwise a page that always fails
  // would be retried forever, at the cost of a model call every time.
  test("a pass that read nothing ends the job rather than looping", () => {
    assert.equal(statusAfterPass(2, [page(0, [])], [0], false), "done");
    assert.equal(statusAfterPass(0, [], [], false), "done");
  });
});

describe("job status rules", () => {
  test("only work still in flight can be cancelled", () => {
    assert.equal(canCancel("pending"), true);
    assert.equal(canCancel("running"), true);
    assert.equal(canCancel("done"), false);
    assert.equal(canCancel("error"), false);
    assert.equal(canCancel("cancelled"), false, "cancelling twice is not a thing");
  });

  // The watcher keeps polling and re-kicking while a job is not terminal, so
  // a cancelled job has to count as finished or it would be resumed.
  test("cancelled counts as finished, like done and error", () => {
    assert.equal(isTerminal("cancelled"), true);
    assert.equal(isTerminal("done"), true);
    assert.equal(isTerminal("error"), true);
    assert.equal(isTerminal("running"), false);
    assert.equal(isTerminal("pending"), false);
  });
});
