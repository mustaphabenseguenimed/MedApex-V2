import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { getGeminiProvider, GEMINI_DEFAULT_MODEL } from "./ai-provider.server";

const OptionExpl = z.object({
  choice_index: z.number().int(),
  is_correct: z.boolean(),
  explanation: z.string(),
});
const AllExpl = z.object({
  options: z.array(OptionExpl),
  overall: z.string(),
});

export const getQuestionExplanations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ questionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("question_explanations")
      .select("choice_index, body")
      .eq("question_id", data.questionId);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [] };
  });

export const generateExplanationsForQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ questionId: z.string().uuid(), force: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: q, error: qErr } = await supabase
      .from("questions")
      .select("id, stem, type, choices, correct_indices, polarity, model_answer, explanation")
      .eq("id", data.questionId)
      .maybeSingle();
    if (qErr) throw new Error(qErr.message);
    if (!q) throw new Error("Question introuvable");

    if (!data.force) {
      const { data: existing } = await supabase
        .from("question_explanations")
        .select("choice_index")
        .eq("question_id", data.questionId)
        .limit(1);
      if (existing && existing.length > 0) return { cached: true };
    }

    const google = getGeminiProvider();
    if (!google) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY manquante");
    const model = google(GEMINI_DEFAULT_MODEL);

    const choices = (q.choices as string[] | null) ?? [];
    const correct = (q.correct_indices as number[] | null) ?? [];

    const prompt = [
      "Tu es un enseignant de médecine. Explique CHAQUE option de cette question en français.",
      "Pour chaque option, dis si elle est vraie ou fausse et pourquoi (physiopath, sémiologie, chiffres clés).",
      "Ajoute une explication globale courte (2-3 phrases).",
      "",
      `Question (${q.type}, polarité=${q.polarity}): ${q.stem}`,
      `Bonnes réponses (indices 0-based): [${correct.join(", ")}]`,
      choices.length
        ? "Options:\n" + choices.map((c, i) => `${i}. ${c}`).join("\n")
        : `Réponse attendue: ${q.model_answer ?? ""}`,
      q.explanation ? `\nContexte fourni par l'auteur: ${q.explanation}` : "",
    ].join("\n");

    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: AllExpl }),
        prompt,
      });

      const rows = output.options
        .filter((o) => o.choice_index >= 0 && o.choice_index < Math.max(choices.length, 1))
        .map((o) => ({
          question_id: data.questionId,
          choice_index: o.choice_index,
          body: o.explanation,
          model: GEMINI_DEFAULT_MODEL,
          generated_by: userId,
        }));
      rows.push({
        question_id: data.questionId,
        choice_index: null as unknown as number,
        body: output.overall,
        model: GEMINI_DEFAULT_MODEL,
        generated_by: userId,
      });

      // Upsert-by-delete-then-insert (unique index handles COALESCE(choice_index,-1))
      await supabase.from("question_explanations").delete().eq("question_id", data.questionId);
      const { error: insErr } = await supabase.from("question_explanations").insert(rows as any);
      if (insErr) throw new Error(insErr.message);

      return { generated: rows.length };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        return { generated: 0, error: "L'IA n'a pas pu structurer la réponse" };
      }
      throw error;
    }
  });

export const askAboutQuestion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ questionId: z.string().uuid(), query: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: q, error: qErr } = await context.supabase
      .from("questions")
      .select("stem, choices, correct_indices, model_answer, explanation")
      .eq("id", data.questionId)
      .maybeSingle();
    if (qErr) throw new Error(qErr.message);
    if (!q) throw new Error("Question introuvable");

    const google = getGeminiProvider();
    if (!google) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY manquante");
    const model = google(GEMINI_DEFAULT_MODEL);

    const choices = (q.choices as string[] | null) ?? [];
    const correct = (q.correct_indices as number[] | null) ?? [];

    const prompt = [
      "Tu es un enseignant de médecine qui aide un étudiant à réviser une question de QCM.",
      "Voici la question, pour contexte :",
      `Question: ${q.stem}`,
      choices.length
        ? "Options:\n" +
          choices.map((c, i) => `${i}. ${c}${correct.includes(i) ? " (correcte)" : ""}`).join("\n")
        : `Réponse attendue: ${q.model_answer ?? ""}`,
      q.explanation ? `Explication fournie par l'auteur: ${q.explanation}` : "",
      "",
      `L'étudiant demande : ${data.query}`,
      "",
      "Réponds en français, de façon claire et concise, en te concentrant sur ce qui aide à comprendre la question ci-dessus.",
    ].join("\n");

    const { text } = await generateText({ model, prompt });
    return { answer: text };
  });
