/**
 * Bookkeeping for a step 1 conversion that runs on the server.
 *
 * A phone cannot keep converting while Android freezes its tab, so the PDF is
 * uploaded once and the pages are extracted server-side. That work outlives
 * any single request: an invocation can hit its deadline halfway through, and
 * the next call has to pick the job up exactly where it stopped. These are the
 * rules for "which pages are left, what has come back, and who owns the job
 * right now" — free of Supabase and React so they can be tested directly.
 */

import type { ExtractedQ } from "./questions.functions";

/** One page of the source PDF, once the model has read it. */
export type JobPage = {
  /** 0-based page index in the uploaded file. */
  index: number;
  questions: ExtractedQ[];
  /** The extractor's own completeness note, when it left one. */
  warning?: string;
};

/**
 * How long a worker owns a job before another may take over.
 *
 * Long enough that a healthy worker mid-page is never stolen from, short
 * enough that a job whose invocation was killed can be resumed while the
 * admin is still looking at the screen.
 */
export const JOB_LEASE_MS = 3 * 60_000;

/** Leave this much of the invocation's budget for the final status write. */
export const JOB_DEADLINE_MARGIN_MS = 25_000;

/** Pages still to extract, in page order — those never done, plus any that
 *  failed and are worth another attempt on this pass. */
export function pagesToProcess(
  totalPages: number,
  pages: JobPage[],
  failedPages: number[],
): number[] {
  const done = new Set(pages.map((p) => p.index));
  const out: number[] = [];
  for (let i = 0; i < totalPages; i++) {
    if (!done.has(i) || failedPages.includes(i)) out.push(i);
  }
  return out.filter((i, k, arr) => arr.indexOf(i) === k);
}

/**
 * Fold one page's result into the list, keeping it ordered by page.
 *
 * Ordered, not appended: a page retried after the ones behind it would
 * otherwise put its questions at the end of the document.
 */
export function applyPage(pages: JobPage[], page: JobPage): JobPage[] {
  const out = pages.filter((p) => p.index !== page.index);
  out.push(page);
  return out.sort((a, b) => a.index - b.index);
}

/** Every question the job has read so far, in the document's own order. */
export function flattenQuestions(pages: JobPage[]): ExtractedQ[] {
  return [...pages].sort((a, b) => a.index - b.index).flatMap((p) => p.questions);
}

/** The completeness notes worth showing, labelled by page. */
export function pageWarnings(
  pages: JobPage[],
  filename: string,
): { filename: string; warning: string }[] {
  return [...pages]
    .sort((a, b) => a.index - b.index)
    .filter((p) => !!p.warning)
    .map((p) => ({ filename: `${filename} (p${p.index + 1})`, warning: p.warning! }));
}

/** Is this job free to be picked up — never claimed, or claimed by a worker
 *  that has since died? */
export function leaseExpired(leaseUntil: string | null | undefined, now = Date.now()): boolean {
  if (!leaseUntil) return true;
  const until = Date.parse(leaseUntil);
  return Number.isNaN(until) || until <= now;
}

/**
 * Should the worker stop before starting another page?
 *
 * A page takes tens of seconds, so the decision is made on how long the last
 * ones actually took rather than on an average: starting a page that cannot
 * finish wastes the call and, worse, loses the result it was in the middle of.
 */
export function shouldStopForDeadline(
  deadlineAt: number,
  lastPageMs: number,
  now = Date.now(),
): boolean {
  return now + lastPageMs + JOB_DEADLINE_MARGIN_MS >= deadlineAt;
}

/**
 * Status a job should carry once a pass over its pages is finished.
 *
 * "running" means the page should start another pass, so it must only be
 * returned when another pass would actually achieve something: a pass that
 * read nothing — every remaining page failing, say — ends the job instead,
 * with its failures on the row. Otherwise the watcher would start pass after
 * pass forever, each one spending model calls on pages that keep failing.
 * Retrying stays available, as a deliberate click.
 */
export function statusAfterPass(
  totalPages: number,
  pages: JobPage[],
  failedPages: number[],
  progressed: boolean,
): "running" | "done" {
  const read = pages.filter((p) => !failedPages.includes(p.index)).length;
  if (totalPages > 0 && read >= totalPages) return "done";
  return progressed ? "running" : "done";
}

/** A job nobody will touch again: finished, failed, or cancelled. */
export function isTerminal(status: string): boolean {
  return status === "done" || status === "error" || status === "cancelled";
}

/** Only work that is still in flight can be called off. */
export function canCancel(status: string): boolean {
  return status === "pending" || status === "running";
}
