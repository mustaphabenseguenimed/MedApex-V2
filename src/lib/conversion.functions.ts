import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";
import { getGeminiProvider, GEMINI_DEFAULT_MODEL } from "./ai-provider.server";
import { buildQuestionsDocx, type DocxQuestionItem } from "./questionsDocxBuilder";
import { friendlyGatewayError, isTransient, retryDelayMs, sleep } from "./questions.functions";

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
        instructions: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const google = getGeminiProvider();
    if (!google) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY manquante");
    const model = google(GEMINI_DEFAULT_MODEL);

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
      "Tu es un enseignant de médecine. On te donne une liste de questions de QCM/QROC avec leur bonne réponse déjà connue (ne la remets jamais en cause), et éventuellement un document de référence.",
      "Pour CHAQUE question, rédige une explication claire et concise justifiant la réponse correcte : base-toi sur le document de référence quand il est pertinent, sinon sur des connaissances médicales fiables. Ne recopie pas l'énoncé ni les options.",
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

    // Same treatment as question extraction: a 429/quota hit is worth
    // waiting out (Google tells us how long) rather than failing the whole
    // batch — free-tier quotas reset within seconds to a couple minutes.
    let lastError: unknown;
    for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
      try {
        const { output } = await generateText({
          model,
          output: Output.object({ schema: ExplainSchema }),
          temperature: 0.3,
          prompt,
        });
        const byIndex = new Map(output.explanations.map((e) => [e.index, e.explanation]));
        return {
          explanations: data.items.map((_, i) => byIndex.get(i) ?? null),
        };
      } catch (error) {
        lastError = error;
        if (NoObjectGeneratedError.isInstance(error)) {
          return { explanations: data.items.map(() => null) };
        }
        if (isTransient(error) && attemptNo < 2) {
          await sleep(retryDelayMs(error, attemptNo));
          continue;
        }
        break;
      }
    }
    throw friendlyGatewayError(lastError);
  });
