import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { fetchAllRows } from "@/lib/fetchAll";

// ---------- SM-2 helpers (server-side utility) ----------
function sm2(prev: { ease: number; interval: number; reps: number; lapses: number }, grade: number) {
  // grade: 0..5 (Anki-style). <3 = lapse.
  let { ease, interval, reps, lapses } = prev;
  if (grade < 3) {
    reps = 0;
    interval = 0;
    lapses += 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 3;
    else interval = Math.round(interval * ease * 10) / 10;
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  return { ease, interval, reps, lapses };
}

// ---------- Flag / Unflag ----------
export const toggleFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ questionId: z.string().uuid(), reason: z.string().max(500).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: existing } = await supabase
      .from("question_flags")
      .select("id")
      .eq("user_id", userId)
      .eq("question_id", data.questionId)
      .maybeSingle();
    if (existing) {
      await supabase.from("question_flags").delete().eq("id", existing.id);
      return { flagged: false };
    }
    await supabase.from("question_flags").insert({ user_id: userId, question_id: data.questionId, reason: data.reason ?? null });
    return { flagged: true };
  });

// ---------- Note upsert ----------
export const upsertNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ questionId: z.string().uuid(), body: z.string().max(4000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("question_notes")
      .upsert({ user_id: userId, question_id: data.questionId, body: data.body, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- Review submit (updates SM-2) ----------
export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      questionId: z.string().uuid(),
      correct: z.boolean(),
      score: z.number().min(0).max(1).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prev } = await supabase
      .from("question_progress")
      .select("ease,interval_days,repetitions,lapses")
      .eq("user_id", userId)
      .eq("question_id", data.questionId)
      .maybeSingle();
    const s = data.score ?? (data.correct ? 1 : 0);
    const grade = data.correct ? (s >= 0.9 ? 5 : s >= 0.6 ? 4 : 3) : s >= 0.4 ? 2 : s > 0 ? 1 : 0;
    const next = sm2(
      {
        ease: Number(prev?.ease ?? 2.5),
        interval: Number(prev?.interval_days ?? 0),
        reps: Number(prev?.repetitions ?? 0),
        lapses: Number(prev?.lapses ?? 0),
      },
      grade,
    );
    const dueAt = new Date(Date.now() + next.interval * 86400 * 1000).toISOString();
    const { error } = await supabase.from("question_progress").upsert({
      user_id: userId,
      question_id: data.questionId,
      ease: next.ease,
      interval_days: next.interval,
      repetitions: next.reps,
      lapses: next.lapses,
      last_grade: grade,
      last_correct: data.correct,
      last_reviewed_at: new Date().toISOString(),
      due_at: dueAt,
      updated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return { grade, due_at: dueAt };
  });

// ---------- Stats ----------
export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const [{ count: totalAnswered }, { count: dueToday }, { count: flagged }, sessionsRes] = await Promise.all([
      supabase.from("question_progress").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("question_progress").select("*", { count: "exact", head: true }).eq("user_id", userId).lte("due_at", nowIso),
      supabase.from("question_flags").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase.from("qcm_sessions").select("id,score,total,finished_at,module_id").eq("user_id", userId).not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(200),
    ]);
    const sessions = sessionsRes.data ?? [];
    let sumScore = 0, sumTotal = 0;
    const perModule: Record<string, { score: number; total: number }> = {};
    for (const s of sessions) {
      const sc = Number(s.score ?? 0);
      sumScore += sc; sumTotal += s.total ?? 0;
      const m = s.module_id as string;
      if (!perModule[m]) perModule[m] = { score: 0, total: 0 };
      perModule[m].score += sc; perModule[m].total += s.total ?? 0;
    }
    return {
      totalAnswered: totalAnswered ?? 0,
      dueToday: dueToday ?? 0,
      flagged: flagged ?? 0,
      totalSessions: sessions.length,
      accuracy: sumTotal > 0 ? sumScore / sumTotal : 0,
      perModule,
    };
  });

// ---------- History ----------
export const getHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("qcm_sessions")
      .select("id,module_id,module_ids,title,started_at,finished_at,score,total,mode,duration_seconds")
      .eq("user_id", userId)
      .order("started_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// ---------- Due / Wrong / Flagged question ids for a module ----------
export const listSourceIds = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      moduleId: z.string().uuid(),
      source: z.enum(["all", "new", "due", "wrong", "flagged"]),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.source === "all") return { ids: null as string[] | null };
    if (data.source === "flagged") {
      const { data: rows } = await supabase.from("question_flags").select("question_id, questions!inner(module_id)").eq("user_id", userId).eq("questions.module_id", data.moduleId);
      return { ids: (rows ?? []).map((r: any) => r.question_id) };
    }
    if (data.source === "due") {
      const { data: rows } = await supabase
        .from("question_progress")
        .select("question_id, questions!inner(module_id)")
        .eq("user_id", userId)
        .eq("questions.module_id", data.moduleId)
        .lte("due_at", new Date().toISOString());
      return { ids: (rows ?? []).map((r: any) => r.question_id) };
    }
    if (data.source === "wrong") {
      const { data: rows } = await supabase
        .from("question_progress")
        .select("question_id, questions!inner(module_id)")
        .eq("user_id", userId)
        .eq("questions.module_id", data.moduleId)
        .eq("last_correct", false);
      return { ids: (rows ?? []).map((r: any) => r.question_id) };
    }
    // new: questions with no progress
    const [all, seen] = await Promise.all([
      fetchAllRows<any>(() => supabase.from("questions").select("id").eq("module_id", data.moduleId).is("parent_id", null)),
      fetchAllRows<any>(() => supabase.from("question_progress").select("question_id, questions!inner(module_id)").eq("user_id", userId).eq("questions.module_id", data.moduleId)),
    ]);
    const seenSet = new Set((seen ?? []).map((r: any) => r.question_id));
    return { ids: (all ?? []).map((r: any) => r.id).filter((id) => !seenSet.has(id)) };
  });
// ---------- Global session builder ----------

const QTYPES = ["qcm", "qcs", "qroc", "cas_clinique"] as const;

const FilterSchema = z.object({
  moduleIds: z.array(z.string().uuid()).min(1).max(100),
  folderIds: z.array(z.string().uuid()).max(500).default([]),
  rotationIds: z.array(z.string().uuid()).max(200).default([]),
  types: z.array(z.enum(QTYPES)).default([]),
  sources: z.array(z.string().max(120)).max(50).default([]),
  yearMin: z.number().int().nullable().default(null),
  yearMax: z.number().int().nullable().default(null),
  unseen: z.boolean().default(false),
  wrong: z.boolean().default(false),
  commented: z.boolean().default(false),
  noted: z.boolean().default(false),
  due: z.boolean().default(false),
  flagged: z.boolean().default(false),
});
export type SessionFilters = z.infer<typeof FilterSchema>;

type Candidate = { id: string; type: string; module_id: string; exam_year: number | null };

async function resolveCandidates(
  supabase: any,
  userId: string,
  f: SessionFilters,
): Promise<Candidate[]> {
  let q = supabase
    .from("questions")
    .select("id,type,module_id,exam_year")
    .in("module_id", f.moduleIds)
    .is("parent_id", null);
  if (f.folderIds.length) q = q.in("folder_id", f.folderIds);
  if (f.rotationIds.length) q = q.overlaps("rotation_ids", f.rotationIds);
  if (f.types.length) q = q.in("type", f.types);
  if (f.sources.length) q = q.in("exam_source", f.sources);
  if (f.yearMin != null) q = q.gte("exam_year", f.yearMin);
  if (f.yearMax != null) q = q.lte("exam_year", f.yearMax);
  let rows = (await fetchAllRows<Candidate>(() => q)) as Candidate[];
  if (rows.length === 0) return rows;

  const needProgress = f.unseen || f.wrong || f.due;
  const [progressRes, notesRes, explRes, flagRes] = await Promise.all([
    needProgress
      ? supabase.from("question_progress").select("question_id,last_correct,due_at").eq("user_id", userId)
      : Promise.resolve({ data: [] }),
    f.noted ? supabase.from("question_notes").select("question_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
    f.commented ? supabase.from("question_explanations").select("question_id") : Promise.resolve({ data: [] }),
    f.flagged ? supabase.from("question_flags").select("question_id").eq("user_id", userId) : Promise.resolve({ data: [] }),
  ]);

  const seen = new Set<string>();
  const wrong = new Set<string>();
  const due = new Set<string>();
  const nowIso = new Date().toISOString();
  for (const r of (progressRes.data ?? []) as any[]) {
    seen.add(r.question_id);
    if (r.last_correct === false) wrong.add(r.question_id);
    if (r.due_at && r.due_at <= nowIso) due.add(r.question_id);
  }
  const noted = new Set<string>(((notesRes.data ?? []) as any[]).map((r) => r.question_id));
  const commented = new Set<string>(((explRes.data ?? []) as any[]).map((r) => r.question_id));
  const flagged = new Set<string>(((flagRes.data ?? []) as any[]).map((r) => r.question_id));

  // Status checkboxes are additive (OR); no checkbox = no status restriction.
  if (f.unseen || f.wrong || f.commented || f.noted || f.due || f.flagged) {
    rows = rows.filter((r) =>
      (f.unseen && !seen.has(r.id)) ||
      (f.wrong && wrong.has(r.id)) ||
      (f.commented && commented.has(r.id)) ||
      (f.noted && noted.has(r.id)) ||
      (f.due && due.has(r.id)) ||
      (f.flagged && flagged.has(r.id)),
    );
  }
  return rows;
}

/** Live count + per-type breakdown for the current filter selection. */
export const countSessionCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FilterSchema.parse(input))
  .handler(async ({ data, context }) => {
    const rows = await resolveCandidates(context.supabase, context.userId, data);
    const byType: Record<string, number> = { qcm: 0, qcs: 0, qroc: 0, cas_clinique: 0 };
    for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
    return { total: rows.length, byType };
  });

function shuffleIds<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Create a multi-module session from the filter selection. */
export const buildSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        filters: FilterSchema,
        title: z.string().max(200).optional(),
        limit: z.number().int().min(1).max(5000),
        sortMode: z.enum(["random", "year_desc", "year_asc", "course"]).default("random"),
        mode: z.enum(["training", "exam"]).default("training"),
        timeLimitMinutes: z.number().int().min(1).max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = await resolveCandidates(supabase, userId, data.filters);
    if (rows.length === 0) throw new Error("Aucune question ne correspond aux filtres");

    let ordered = rows;
    if (data.sortMode === "random") ordered = shuffleIds(rows);
    else if (data.sortMode === "year_desc") ordered = rows.slice().sort((a, b) => (b.exam_year ?? 0) - (a.exam_year ?? 0));
    else if (data.sortMode === "year_asc") ordered = rows.slice().sort((a, b) => (a.exam_year ?? 0) - (b.exam_year ?? 0));

    const picks = ordered.slice(0, Math.min(data.limit, ordered.length));
    const { data: inserted, error } = await supabase
      .from("qcm_sessions")
      .insert({
        user_id: userId,
        module_id: data.filters.moduleIds[0],
        module_ids: data.filters.moduleIds,
        title: data.title ?? null,
        sort_mode: data.sortMode,
        types: data.filters.types.length ? data.filters.types : null,
        question_ids: picks.map((p) => p.id),
        total: picks.length,
        mode: data.mode,
        time_limit_seconds: data.mode === "exam" && data.timeLimitMinutes ? data.timeLimitMinutes * 60 : null,
        filters: data.filters as any,
      })
      .select("id, module_id")
      .single();
    if (error) throw new Error(error.message);
    return { sessionId: inserted.id as string, moduleId: inserted.module_id as string, total: picks.length };
  });

/** Queue the matching questions into the spaced-repetition list. */
export const addToSpacedRepetition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FilterSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const rows = await resolveCandidates(supabase, userId, data);
    if (rows.length === 0) return { added: 0 };
    const { data: existing } = await supabase
      .from("question_progress")
      .select("question_id")
      .eq("user_id", userId)
      .in("question_id", rows.slice(0, 1000).map((r) => r.id));
    const have = new Set(((existing ?? []) as any[]).map((r) => r.question_id));
    const nowIso = new Date().toISOString();
    const toAdd = rows.filter((r) => !have.has(r.id)).slice(0, 1000).map((r) => ({
      user_id: userId,
      question_id: r.id,
      ease: 2.5,
      interval_days: 0,
      repetitions: 0,
      lapses: 0,
      due_at: nowIso,
      updated_at: nowIso,
    }));
    if (toAdd.length === 0) return { added: 0 };
    const { error } = await supabase.from("question_progress").upsert(toAdd);
    if (error) throw new Error(error.message);
    return { added: toAdd.length };
  });
