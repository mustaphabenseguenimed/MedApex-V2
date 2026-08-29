// Shared DB-write logic for importing AI-extracted questions into the
// `questions` table — used by the "Importer un programme" tool
// (admin.index.tsx) and the conversion tool's direct-import flow
// (admin.convert.tsx) so both share one tested implementation.

import type { supabase as supabaseClient } from "@/integrations/supabase/client";
import type { ExtractedQ } from "@/lib/questions.functions";

export type ImportableQuestion = ExtractedQ & {
  /** Real rotation id, or "__none". */
  rotation_id: string;
  rotation_ids: string[];
  /** Numeric exam year as a string, or "__none". */
  exam_year: string;
  exam_years: string[];
  folder_id?: string | null;
};

/** Normalized grouping key for "questions sharing a cas-clinique énoncé". */
export function caseKey(q: { case_stem?: string | null }): string {
  return (q.case_stem ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Insert questions into a module, grouping any sharing a `case_stem` under a
 * shared `cas_clinique` parent (inserted first, so its real id can be used
 * as `parent_id`). Throws on Supabase error.
 */
export async function importQuestionsToModule(
  supabase: typeof supabaseClient,
  params: { moduleId: string; moduleYear: number; items: ImportableQuestion[] },
): Promise<{ count: number; caseCount: number }> {
  const { moduleId, moduleYear, items } = params;
  if (items.length === 0) return { count: 0, caseCount: 0 };

  const { data: maxRow } = await (supabase as any)
    .from("questions")
    .select("sort_order")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  const base = Number(maxRow?.sort_order ?? 0);
  const rowFor = (q: ImportableQuestion, order: number) => ({
    module_id: moduleId,
    year: moduleYear,
    rotation_id: q.rotation_id === "__none" ? null : q.rotation_id,
    rotation_ids: (q.rotation_ids ?? []).filter((r) => r && r !== "__none"),
    folder_id: q.folder_id && q.folder_id !== "__none" ? q.folder_id : null,
    exam_year: q.exam_year === "__none" ? null : Number(q.exam_year),
    exam_years: (q.exam_years ?? []).map(Number).filter((n) => Number.isFinite(n)),
    type: q.type,
    polarity: "correct",
    stem: q.stem,
    choices: q.type === "qroc" ? null : (q.choices ?? []),
    correct_indices: q.type === "qroc" ? null : (q.correct_indices ?? []),
    model_answer: q.type === "qroc" ? (q.model_answer ?? "") : null,
    explanation: q.explanation,
    parent_id: null,
    sort_order: base + order * 10,
  });
  const fail = (error: any, sampleRow: any, rowCount: number) => {
    console.error("[importQuestionsToModule] insert failed", { error, sampleRow, rowCount });
    const detail = [error.message, error.details, error.hint, error.code]
      .filter(Boolean)
      .join(" — ");
    throw new Error(detail || "Insert failed");
  };

  const caseParentId = new Map<string, string>();
  const caseKeys: string[] = [];
  for (const q of items) {
    const k = caseKey(q);
    if (k && !caseKeys.includes(k)) caseKeys.push(k);
  }
  let order = 0;
  if (caseKeys.length) {
    const parentRows = caseKeys.map((k) => {
      const first = items.find((q) => caseKey(q) === k)!;
      return {
        ...rowFor(first, ++order),
        type: "cas_clinique",
        stem: first.case_stem ?? k,
        choices: null,
        correct_indices: null,
        model_answer: null,
        explanation: null,
      };
    });
    const { data: inserted, error: perr } = await (supabase as any)
      .from("questions")
      .insert(parentRows)
      .select("id");
    if (perr) fail(perr, parentRows[0], parentRows.length);
    (inserted ?? []).forEach((r: any, i: number) => caseParentId.set(caseKeys[i], r.id));
  }

  const rows = items.map((q) => {
    const k = caseKey(q);
    const parentId = k ? (caseParentId.get(k) ?? null) : null;
    return { ...rowFor(q, ++order), parent_id: parentId };
  });
  const { error } = await (supabase as any).from("questions").insert(rows);
  if (error) fail(error, rows[0], rows.length);

  return { count: rows.length, caseCount: caseKeys.length };
}
