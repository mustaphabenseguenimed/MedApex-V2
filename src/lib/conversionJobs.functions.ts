import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";
import { splitPdfIntoPageChunks } from "./fileUtils";
import { extractQuestionsFromPdfBase64, type ExtractedQ } from "./questions.functions";
import {
  applyPage,
  flattenQuestions,
  JOB_LEASE_MS,
  leaseExpired,
  pageWarnings,
  pagesToProcess,
  shouldStopForDeadline,
  statusAfterPass,
  type JobPage,
} from "./conversionJobs";

/**
 * Step 1's background conversion.
 *
 * The PDF is uploaded straight to storage by the browser, and everything else
 * happens here: the page only creates the job, kicks a worker and watches the
 * row. That is what lets a phone be pocketed mid-conversion — the tab freezing
 * no longer stops anything.
 */

/**
 * How long one worker pass may run.
 *
 * Deliberately short of the platform's function ceiling: a pass that is cut
 * off mid-page loses that page's work, while a pass that stops on its own
 * leaves a clean, resumable row behind. Whatever is left is picked up by the
 * next call.
 */
const WORKER_BUDGET_MS = 240_000;

/**
 * Ceiling for one page's PDF once base64-encoded.
 *
 * Nothing like the browser's 3.5 MB: this chunk goes from our server straight
 * to the model, so the only limit is what it accepts inline. Pages heavier
 * than this are reported rather than silently dropped.
 */
const MAX_SERVER_CHUNK = 12_000_000;

const BUCKET = "conversion-library";

/** `pages` is a jsonb column, so the generated row type calls it Json; this
 *  is the shape the worker actually writes there. */
type JobRow = {
  id: string;
  filename: string;
  storage_path: string;
  hint: string | null;
  status: string;
  total_pages: number;
  done_pages: number;
  pages: unknown;
  failed_pages: number[];
  error: string | null;
  lease_until: string | null;
  created_at: string;
  updated_at: string;
};

const readPages = (raw: unknown): JobPage[] => (Array.isArray(raw) ? (raw as JobPage[]) : []);

const nowIso = () => new Date().toISOString();
const leaseIso = () => new Date(Date.now() + JOB_LEASE_MS).toISOString();

/** Create the row for a PDF the browser has already put in storage. */
export const createConversionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        storagePath: z.string().min(1).max(400),
        filename: z.string().min(1).max(200),
        hint: z.string().max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const { data: row, error } = await supabase
      .from("conversion_jobs")
      .insert({
        created_by: userId,
        filename: data.filename,
        storage_path: data.storagePath,
        hint: data.hint ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { jobId: row.id as string };
  });

/** The job as the page needs to render it. */
export const getConversionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const { data: row, error } = await supabase
      .from("conversion_jobs")
      .select("*")
      .eq("id", data.jobId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Conversion introuvable");
    const job = row as JobRow;
    const pages = readPages(job.pages);
    return {
      id: job.id,
      filename: job.filename,
      status: job.status,
      totalPages: job.total_pages,
      donePages: job.done_pages,
      failedPages: job.failed_pages ?? [],
      error: job.error,
      /** True when no worker holds it — the page may kick one. */
      resumable:
        leaseExpired(job.lease_until) && (job.status === "pending" || job.status === "running"),
      questions: job.status === "done" ? flattenQuestions(pages) : ([] as ExtractedQ[]),
      warnings: job.status === "done" ? pageWarnings(pages, job.filename) : [],
    };
  });

/** Recent jobs, so one started on a phone can be opened from a laptop. */
export const listConversionJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const { data, error } = await supabase
      .from("conversion_jobs")
      .select("id, filename, status, total_pages, done_pages, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    if (error) throw new Error(error.message);
    return {
      jobs: (data ?? []).map((row) => ({
        id: row.id,
        filename: row.filename,
        status: row.status,
        totalPages: row.total_pages,
        donePages: row.done_pages,
        createdAt: row.created_at,
      })),
    };
  });

/**
 * Call off a conversion that is still running.
 *
 * The row is the only thing a worker and the page share, so cancelling is a
 * write to it: the worker checks between pages and stops, and the claim in
 * `runConversionJob` only accepts pending or running, so nothing picks it up
 * afterwards. Pages already read stay on the row.
 */
export const cancelConversionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const { data: row, error } = await supabase
      .from("conversion_jobs")
      .update({ status: "cancelled", lease_until: null, updated_at: nowIso() })
      .eq("id", data.jobId)
      .in("status", ["pending", "running"])
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Not an error: the job finished (or was already cancelled) while the
    // click was in flight.
    return { cancelled: !!row };
  });

/**
 * Convert as many pages as this invocation has time for.
 *
 * Claims the job first: a lease keeps two callers (the phone and a laptop,
 * say) from doing the same pages twice, and expires on its own so a worker
 * killed by the platform never strands the job.
 */
export const runConversionJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ jobId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const deadlineAt = Date.now() + WORKER_BUDGET_MS;

    const { data: claimed, error: claimError } = await supabase
      .from("conversion_jobs")
      .update({ status: "running", lease_until: leaseIso(), updated_at: nowIso() })
      .eq("id", data.jobId)
      .in("status", ["pending", "running"])
      .or(`lease_until.is.null,lease_until.lt.${nowIso()}`)
      .select("*")
      .maybeSingle();
    if (claimError) throw new Error(claimError.message);
    // Someone else is on it, or it is already finished — either way there is
    // nothing for this call to do.
    if (!claimed) return { claimed: false };

    const job = claimed as JobRow;
    let pages = readPages(job.pages);
    let failed = [...(job.failed_pages ?? [])];

    try {
      const blob = await downloadSource(supabase, job.storage_path);
      const bytes = await blob.arrayBuffer();
      // One page per call with the previous one as context, exactly as the
      // in-page path does — but with a server-sized ceiling, so a heavy
      // scanned page goes as PDF instead of being re-rendered as an image.
      const split = await splitPdfIntoPageChunks(bytes, 1, 1, { maxDataUrl: MAX_SERVER_CHUNK });
      const totalPages = split.totalPages;
      if (!split.chunks.length) {
        throw new Error(
          split.tooHeavyToSplit
            ? "PDF trop lourd pour être découpé page par page"
            : "Fichier vide ou illisible",
        );
      }

      let lastPageMs = 45_000; // first page: assume a slow one
      let progressed = false;
      for (const pageIndex of pagesToProcess(totalPages, pages, failed)) {
        if (shouldStopForDeadline(deadlineAt, lastPageMs)) break;
        const chunk = split.chunks.find((c) => c.firstPageIndex === pageIndex);
        if (!chunk) continue;
        const startedAt = Date.now();
        try {
          const base64 = chunk.dataUrl.replace(/^data:application\/pdf;base64,/i, "");
          const result = await extractQuestionsFromPdfBase64({
            base64,
            filename: `${job.filename} (p${pageIndex + 1})`,
            hint: job.hint ?? undefined,
            detectCases: true,
            contextPages: chunk.contextPages,
          });
          pages = applyPage(pages, {
            index: pageIndex,
            questions: result.questions ?? [],
            ...(result.warning ? { warning: result.warning } : {}),
          });
          failed = failed.filter((i) => i !== pageIndex);
          progressed = true;
        } catch {
          // One page's failure is not the job's: record it and carry on, so
          // the rest of the document still gets read.
          pages = applyPage(pages, { index: pageIndex, questions: [] });
          if (!failed.includes(pageIndex)) failed.push(pageIndex);
        }
        lastPageMs = Date.now() - startedAt;
        await saveProgress(supabase, job.id, {
          pages,
          failed,
          totalPages,
          status: "running",
          lease: leaseIso(),
        });
        // The page can call the job off mid-run; the row is where it says so.
        if (await wasCancelled(supabase, job.id)) return { claimed: true, status: "cancelled" };
      }

      const status = statusAfterPass(totalPages, pages, failed, progressed);
      await saveProgress(supabase, job.id, {
        pages,
        failed,
        totalPages,
        status,
        // Release the lease so the next pass — for whatever is left — can
        // start immediately rather than waiting the lease out.
        lease: null,
      });
      return { claimed: true, status, donePages: pages.length, totalPages, failedPages: failed };
    } catch (e) {
      await supabase
        .from("conversion_jobs")
        .update({
          status: "error",
          error: e instanceof Error ? e.message : String(e),
          lease_until: null,
          updated_at: nowIso(),
        })
        .eq("id", job.id)
        .in("status", ["pending", "running"]);
      throw e;
    }
  });

type Db = SupabaseClient<Database>;

async function downloadSource(supabase: Db, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "Fichier source introuvable");
  return data as Blob;
}

async function saveProgress(
  supabase: Db,
  jobId: string,
  state: {
    pages: JobPage[];
    failed: number[];
    totalPages: number;
    status: string;
    lease: string | null;
  },
): Promise<void> {
  await supabase
    .from("conversion_jobs")
    .update({
      pages: state.pages,
      failed_pages: state.failed,
      total_pages: state.totalPages,
      done_pages: state.pages.filter((p) => !state.failed.includes(p.index)).length,
      status: state.status,
      lease_until: state.lease,
      updated_at: nowIso(),
    })
    .eq("id", jobId)
    // Only ever writes over work in flight: a job cancelled while this page
    // was being read must not be flipped back to running or done.
    .in("status", ["pending", "running"]);
}

/** Has the page called this job off since the last page? */
async function wasCancelled(supabase: Db, jobId: string): Promise<boolean> {
  const { data } = await supabase
    .from("conversion_jobs")
    .select("status")
    .eq("id", jobId)
    .maybeSingle();
  return data?.status === "cancelled";
}
