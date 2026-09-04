import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";
import { buildQuestionsDocx, type DocxQuestionItem } from "./questionsDocxBuilder";
import { friendlyGatewayError, generateWithFallback } from "./aiGenerate.server";

/** Plain-text extraction from an uploaded reference .docx (course notes,
 *  textbook excerpt, …) — no image/formatting handling needed, just text
 *  to ground step 2's explanation generation. */
export const extractDocxPlainText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        docxDataUrl: z
          .string()
          .max(30_000_000)
          .regex(
            /^data:(application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/octet-stream);base64,/i,
            "DOCX invalide",
          ),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const mammoth = await import("mammoth");
    const base64 = data.docxDataUrl.replace(/^data:[^;]+;base64,/i, "");
    const buffer = Buffer.from(base64, "base64");
    const result = await mammoth.extractRawText({ buffer });
    return { text: (result.value ?? "").trim() };
  });

const DocxItemSchema = z.object({
  stem: z.string(),
  choices: z.array(z.string()).nullable(),
  correct_indices: z.array(z.number().int()).nullable(),
  model_answer: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  case_stem: z.string().nullable().optional(),
  rotation_hint: z.string().nullable().optional(),
});

/** Steps 1 & 2: write a .docx in the app's "Question N / choices / Réponse
 *  correcte :" layout — the same layout questionChunks.ts already reads. */
export const generateQuestionsDocx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z.array(DocxItemSchema).min(1),
        includeExplanations: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = await buildQuestionsDocx(
      data.items as DocxQuestionItem[],
      data.includeExplanations,
    );
    return { base64 };
  });

const ExplainedItem = z.object({
  index: z.number().int(),
  explanation: z.string(),
  /** Set when the answer we were given looks wrong. The answer is never
   *  overridden on this basis — it is surfaced for the admin to check, so an
   *  extraction mistake upstream stops being laundered into a confident
   *  explanation of the wrong option. */
  answer_doubt: z.string().nullable().optional(),
});
const ExplainSchema = z.object({ explanations: z.array(ExplainedItem) });

/** Step 2: generate an explanation for each question, grounded in a
 *  reference document (course notes, textbook excerpt, …) when relevant. */
export const generateGroundedExplanations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              stem: z.string(),
              choices: z.array(z.string()).nullable(),
              correct_indices: z.array(z.number().int()).nullable(),
              model_answer: z.string().nullable().optional(),
            }),
          )
          .min(1)
          .max(60),
        referenceText: z.string().max(200_000).optional(),
        instructions: z.string().max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");

    const questionsBlock = data.items
      .map((q, i) => {
        const choices = q.choices ?? [];
        const correct = q.correct_indices ?? [];
        const lines = [
          `[${i}] Question: ${q.stem}`,
          choices.length
            ? "Options:\n" +
              choices
                .map((c, k) => `${k}. ${c}${correct.includes(k) ? " (correcte)" : ""}`)
                .join("\n")
            : `Réponse attendue: ${q.model_answer ?? ""}`,
        ];
        return lines.join("\n");
      })
      .join("\n\n");

    const prompt = [
      "Tu es un enseignant de médecine. On te donne une liste de questions de QCM/QROC avec leur bonne réponse déjà connue, et éventuellement un document de référence.",
      "Pour CHAQUE question, rédige une explication claire et concise justifiant la réponse correcte : base-toi sur le document de référence quand il est pertinent, sinon sur des connaissances médicales fiables. Ne recopie pas l'énoncé ni les options.",
      "MISE EN FORME de explanation: si tu justifies plusieurs propositions, retourne une liste HTML <ul><li><strong>A.</strong> …</li><li><strong>B.</strong> …</li></ul>, une <li> par proposition, jamais plusieurs justifications collées dans un même <p>. Si l'explication est unique et globale, garde un simple <p>.",
      "N'écris JAMAIS que la réponse fournie est fausse dans le champ explanation : rédige toujours l'explication de la réponse indiquée. En revanche, si cette réponse te paraît médicalement erronée, remplis EN PLUS le champ answer_doubt avec une phrase courte disant ce qui te semble être la bonne réponse et pourquoi. Laisse answer_doubt à null quand la réponse fournie est correcte — c'est le cas le plus fréquent, ne le remplis pas par excès de prudence.",
      "Réponds pour toutes les questions listées ci-dessous, une entrée par index, dans n'importe quel ordre mais sans en omettre.",
      "",
      "Questions :",
      questionsBlock,
      "",
      data.referenceText
        ? `Document de référence (source d'information) :\n${data.referenceText.slice(0, 150_000)}`
        : "Aucun document de référence fourni : base-toi sur tes connaissances médicales générales.",
      data.instructions ? `\nInstructions supplémentaires de l'admin :\n${data.instructions}` : "",
    ].join("\n");

    // Shares the extraction path's retry/backoff, timeout and safety settings
    // instead of hand-rolling them here — this call previously had no timeout
    // at all, so a hung request ran to the function's ceiling.
    try {
      const { output } = await generateWithFallback(
        ExplainSchema,
        [{ type: "text", text: prompt }],
        { temperature: 0.3, timeoutMs: 150_000 },
      );
      const byIndex = new Map(output.explanations.map((e) => [e.index, e]));
      return {
        explanations: data.items.map((_, i) => byIndex.get(i)?.explanation ?? null),
        doubts: data.items.map((_, i) => byIndex.get(i)?.answer_doubt ?? null),
      };
    } catch (error) {
      // A schema miss that survived every retry means this batch produced
      // nothing usable. Report it as empty rather than failing the whole run,
      // but the caller counts the nulls and warns instead of claiming success.
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          explanations: data.items.map(() => null),
          doubts: data.items.map(() => null),
        };
      }
      throw friendlyGatewayError(error);
    }
  });
