import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

function sm2(
  prev: { ease: number; interval: number; reps: number; lapses: number },
  grade: number,
) {
  let { ease, interval, reps, lapses } = prev;
  if (grade < 3) {
    reps = 0;
    interval = 1;
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

export const listDueFlashcards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("flashcards")
      .select("id, front, back, question_id, module_id, tags, due_at, ease, interval_days, repetitions, lapses")
      .eq("user_id", userId)
      .eq("suspended", false)
      .lte("due_at", nowIso)
      .order("due_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const countFlashcards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const nowIso = new Date().toISOString();
    const [{ count: total }, { count: due }] = await Promise.all([
      supabase.from("flashcards").select("*", { count: "exact", head: true }).eq("user_id", userId),
      supabase
        .from("flashcards")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("suspended", false)
        .lte("due_at", nowIso),
    ]);
    return { total: total ?? 0, due: due ?? 0 };
  });

export const reviewFlashcard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), grade: z.number().int().min(0).max(5) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: card, error } = await supabase
      .from("flashcards")
      .select("ease, interval_days, repetitions, lapses")
      .eq("id", data.id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!card) throw new Error("Carte introuvable");
    const next = sm2(
      {
        ease: Number(card.ease),
        interval: Number(card.interval_days),
        reps: Number(card.repetitions),
        lapses: Number(card.lapses),
      },
      data.grade,
    );
    const dueAt = new Date(Date.now() + Math.max(1, next.interval) * 86400 * 1000).toISOString();
    const { error: upErr } = await supabase
      .from("flashcards")
      .update({
        ease: next.ease,
        interval_days: next.interval,
        repetitions: next.reps,
        lapses: next.lapses,
        last_grade: data.grade,
        last_reviewed_at: new Date().toISOString(),
        due_at: dueAt,
      })
      .eq("id", data.id)
      .eq("user_id", userId);
    if (upErr) throw new Error(upErr.message);
    return { due_at: dueAt };
  });

const CardInput = z.object({
  front: z.string().min(1).max(4000),
  back: z.string().min(1).max(8000),
  question_id: z.string().uuid().optional().nullable(),
  choice_index: z.number().int().min(0).optional().nullable(),
  module_id: z.string().uuid().optional().nullable(),
  tags: z.array(z.string()).optional(),
});

export const createFlashcard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CardInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("flashcards")
      .insert({
        user_id: userId,
        front: data.front,
        back: data.back,
        question_id: data.question_id ?? null,
        choice_index: data.choice_index ?? null,
        module_id: data.module_id ?? null,
        tags: data.tags ?? [],
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteFlashcard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("flashcards")
      .delete()
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const createFlashcardsFromSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: session } = await supabase
      .from("qcm_sessions")
      .select("id, user_id, module_id, question_ids, answers, grades")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!session || session.user_id !== userId) throw new Error("Session introuvable");

    const ids = (session.question_ids as string[]) ?? [];
    if (ids.length === 0) return { created: 0 };
    const { data: questions } = await supabase
      .from("questions")
      .select("id, type, stem, choices, correct_indices, polarity, model_answer, explanation, module_id")
      .in("id", ids);
    const answers = (session.answers as Record<string, any>) ?? {};
    const grades = (session.grades as Record<string, any>) ?? {};

    // Existing card fingerprints to avoid duplicates
    const { data: existing } = await supabase
      .from("flashcards")
      .select("question_id, choice_index")
      .eq("user_id", userId)
      .in("question_id", ids);
    const exists = new Set((existing ?? []).map((r: any) => `${r.question_id}:${r.choice_index ?? "x"}`));

    const rows: any[] = [];
    for (const q of questions ?? []) {
      if (q.type === "cas_clinique") continue;
      const correct = (q.correct_indices as number[] | null) ?? [];
      if (q.type === "qroc") {
        const g = grades[q.id];
        if (g && g.verdict !== "correct" && !exists.has(`${q.id}:x`)) {
          rows.push({
            user_id: userId,
            question_id: q.id,
            module_id: q.module_id,
            front: q.stem,
            back: q.model_answer ?? q.explanation ?? "",
          });
        }
      } else {
        const ans = answers[q.id];
        const picks: number[] = Array.isArray(ans) ? ans : ans != null ? [ans] : [];
        const target =
          q.polarity === "correct" ? correct : ((q.choices as string[] | null) ?? []).map((_, i) => i).filter((i) => !correct.includes(i));
        const wrongPicked = picks.filter((i) => !target.includes(i));
        const missed = target.filter((i) => !picks.includes(i));
        for (const idx of [...wrongPicked, ...missed]) {
          if (exists.has(`${q.id}:${idx}`)) continue;
          const ch = (q.choices as string[] | null)?.[idx] ?? "";
          rows.push({
            user_id: userId,
            question_id: q.id,
            choice_index: idx,
            module_id: q.module_id,
            front: `${q.stem}\n\nOption ${String.fromCharCode(65 + idx)}: ${ch}`,
            back: (target.includes(idx) ? "✓ Bonne réponse. " : "✗ Mauvaise réponse. ") + (q.explanation ?? ""),
          });
          exists.add(`${q.id}:${idx}`);
        }
      }
    }
    if (rows.length === 0) return { created: 0 };
    const { error } = await supabase.from("flashcards").insert(rows);
    if (error) throw new Error(error.message);
    return { created: rows.length };
  });

// -------- Reports --------
export const reportQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        questionId: z.string().uuid(),
        reason: z.enum(["error", "typo", "ambiguous", "outdated", "other"]),
        details: z.string().max(2000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("question_reports").insert({
      user_id: context.userId,
      question_id: data.questionId,
      reason: data.reason,
      details: data.details ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });