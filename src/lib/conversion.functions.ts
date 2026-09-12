import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { NoObjectGeneratedError } from "ai";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";
import { buildQuestionsDocx, type DocxQuestionItem } from "./questionsDocxBuilder";
import {
  friendlyGatewayError,
  generateWithFallback,
  generateGroundedText,
} from "./aiGenerate.server";
import { answerLetters, parseAnswerVerdicts } from "./answerVerdicts";

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
  /** Set when the answer we were given looks wrong. Nothing is overridden on
   *  this basis alone — a disagreement here only sends the question on to the
   *  web-grounded second opinion (`verifyAnswersGrounded`), which is what
   *  actually decides. */
  answer_doubt: z.string().nullable().optional(),
  /** The model's own reading of the correct answer, independent of the key we
   *  supplied. Always filled for QCM/QCS; comparing it against the supplied
   *  key is what picks the small subset worth a web lookup. */
  proposed_indices: z.array(z.number().int()).nullable().optional(),
  answer_confidence: z.enum(["high", "medium", "low"]).nullable().optional(),
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
        // Generous sanity ceiling only — the handler below truncates to
        // 150k before it ever reaches the prompt. This must stay above that
        // truncation point, or a normal-sized reference document (a course
        // chapter easily runs past 200k characters) fails validation before
        // the intended truncation gets a chance to run, surfacing a raw
        // Zod error instead of just quietly using less of the document.
        referenceText: z.string().max(500_000).optional(),
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
      // Numbered, not lettered: association questions carry their items as
      // "1. … 5." in the stem, and the .docx writer turns each <li> into its
      // own line, so the numbers line up with what the reader is looking at.
      // The numbers are literal text inside a <ul> rather than an <ol>, or
      // the browser's own list marker would render them twice ("1. 1. …").
      "MISE EN FORME de explanation: si tu justifies plusieurs propositions, retourne une liste HTML <ul><li><strong>1.</strong> …</li><li><strong>2.</strong> …</li></ul> — une <li> par proposition, NUMÉROTÉE 1, 2, 3… dans l'ordre des propositions, jamais plusieurs justifications collées dans un même <p> ou une même <li>. Si l'explication est unique et globale, garde un simple <p>.",
      "N'écris JAMAIS que la réponse fournie est fausse dans le champ explanation : rédige toujours l'explication de la réponse indiquée. En revanche, si cette réponse te paraît médicalement erronée, remplis EN PLUS le champ answer_doubt avec une phrase courte disant ce qui te semble être la bonne réponse et pourquoi. Laisse answer_doubt à null quand la réponse fournie est correcte — c'est le cas le plus fréquent, ne le remplis pas par excès de prudence.",
      "DÉTERMINE AUSSI la réponse par toi-même, sans supposer que la réponse fournie est juste : remplis proposed_indices avec les indices 0-based que TU juges corrects d'après le document de référence et tes connaissances médicales, et answer_confidence avec high, medium ou low. Pour une QROC, laisse proposed_indices à null. Le plus souvent proposed_indices sera identique à la réponse fournie — c'est normal, ne cherche pas à t'en écarter.",
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
        { temperature: 0.3, timeoutMs: 220_000 },
      );
      const byIndex = new Map(output.explanations.map((e) => [e.index, e]));
      return {
        explanations: data.items.map((_, i) => byIndex.get(i)?.explanation ?? null),
        doubts: data.items.map((_, i) => byIndex.get(i)?.answer_doubt ?? null),
        proposed: data.items.map((_, i) => byIndex.get(i)?.proposed_indices ?? null),
        confidence: data.items.map((_, i) => byIndex.get(i)?.answer_confidence ?? null),
      };
    } catch (error) {
      // A schema miss that survived every retry means this batch produced
      // nothing usable. Report it as empty rather than failing the whole run,
      // but the caller counts the nulls and warns instead of claiming success.
      if (NoObjectGeneratedError.isInstance(error)) {
        return {
          explanations: data.items.map(() => null),
          doubts: data.items.map(() => null),
          proposed: data.items.map(() => null),
          confidence: data.items.map(() => null),
        };
      }
      throw friendlyGatewayError(error);
    }
  });

/**
 * Step 2, second opinion: for the questions where the explanation pass
 * disagreed with the recorded answer, decide the answer against the reference
 * document *and* current sources on the web.
 *
 * Only the disputed minority reaches here, so the usual run pays nothing for
 * it. Text in, text out — see `generateGroundedText` for why a grounded call
 * can't use a schema.
 */
export const verifyAnswersGrounded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        items: z
          .array(
            z.object({
              /** Position in the caller's full question list, echoed back so
               *  the caller can apply verdicts without tracking order. */
              index: z.number().int().min(0),
              stem: z.string(),
              choices: z.array(z.string()).min(1),
              correct_indices: z.array(z.number().int()).nullable(),
              proposed_indices: z.array(z.number().int()).nullable().optional(),
              doubt: z.string().nullable().optional(),
            }),
          )
          .min(1)
          .max(20),
        referenceText: z.string().max(500_000).optional(),
        instructions: z.string().max(5000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");

    const questionsBlock = data.items
      .map((q) =>
        [
          `[${q.index}] ${q.stem}`,
          q.choices.map((c, k) => `${String.fromCharCode(65 + k)}. ${c}`).join("\n"),
          `Réponse du document : ${answerLetters(q.correct_indices)} — première lecture de l'IA : ${answerLetters(q.proposed_indices)}${q.doubt ? ` (${q.doubt})` : ""}`,
        ].join("\n"),
      )
      .join("\n\n");

    const prompt = [
      "Tu es un enseignant de médecine. Pour chaque question ci-dessous, la réponse notée dans le document de cours et la première lecture de l'IA divergent. Tranche.",
      "Utilise la recherche web pour vérifier les faits auprès de sources médicales fiables et à jour (recommandations de sociétés savantes, références universitaires), en plus du document de référence fourni.",
      "",
      "Réponds UNIQUEMENT par une ligne par question, strictement à ce format, sans autre texte :",
      "[index] FINAL=<lettres de la bonne réponse, ex. B ou AC, ou - si tu ne peux pas trancher> CONF=<high|medium|low> WHY=<une phrase courte en français>",
      "Exemple : [7] FINAL=B CONF=high WHY=la corticothérapie est contre-indiquée dans cette situation.",
      "N'utilise FINAL=- que si les sources se contredisent ou si la question est trop ambiguë pour trancher.",
      "",
      "Questions :",
      questionsBlock,
      "",
      data.referenceText
        ? `Document de référence (cours source) :\n${data.referenceText.slice(0, 60_000)}`
        : "Aucun document de référence fourni.",
      data.instructions ? `\nInstructions supplémentaires de l'admin :\n${data.instructions}` : "",
    ].join("\n");

    const countByIndex = new Map(data.items.map((q) => [q.index, q.choices.length]));

    try {
      const { text, sources } = await generateGroundedText(prompt, {
        temperature: 0.1,
        timeoutMs: 180_000,
      });
      const verdicts = parseAnswerVerdicts(text, (i) => countByIndex.get(i) ?? 0).filter((v) =>
        countByIndex.has(v.index),
      );
      return { verdicts, sources };
    } catch (error) {
      const friendly = friendlyGatewayError(error);
      // Google meters grounded web search on its own, much tighter allowance
      // than plain generation, so this is the one call in the pipeline that
      // runs out while everything else still works. Say that, instead of the
      // generic "Quota IA atteint" that reads like the whole AI budget is
      // gone — the explanations for this run were generated normally.
      if (/quota|rate.?limit|trop de requêtes|RESOURCE_EXHAUSTED/i.test(friendly.message)) {
        throw new Error(
          "Quota de recherche web atteint (Google limite la recherche séparément des autres appels IA). Les explications, elles, ont bien été générées.",
        );
      }
      throw friendly;
    }
  });
