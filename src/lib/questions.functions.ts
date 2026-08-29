import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";
import {
  normalizeInlineTextColors,
  stripImportedColors,
  stripBold,
  isUnreadableOnDark,
} from "./htmlColors";
import { getExtractModelCandidates, type ExtractEngine } from "./ai-extract-provider.server";
import {
  buildQuestionUnits,
  chunkUnits,
  textToHtml,
  type PreparedChunk,
  type QHeader,
} from "./questionChunks";
import { parseQuestionsLocally } from "./questionsFallback";

export type ExtractResult = {
  questions: ExtractedQ[];
  engine: ExtractEngine;
  /** How many questions the source chunk was supposed to contain (0 = unknown). */
  expected?: number;
  /** Set when the chunk could not be fully extracted after retries. */
  warning?: string;
  /** Self-reported count of distinct questions the model says it saw in this
   *  chunk (PDF path only — there is no independent ground truth for an
   *  image-based PDF chunk, so this is an AI heuristic, not a hard fact). */
  total_visible?: number | null;
};

/** Surface a friendly error when the AI gateway rejects a request (credits,
 *  quota, auth). Otherwise re-throw the original error. */
export function friendlyGatewayError(error: unknown): Error {
  const anyErr = error as any;
  const status: number | undefined =
    anyErr?.statusCode ?? anyErr?.status ?? anyErr?.response?.status ?? anyErr?.cause?.statusCode;
  const raw: string = String(anyErr?.message ?? anyErr?.responseBody ?? "");
  if (status === 402 || /payment required|insufficient/i.test(raw)) {
    return new Error("Crédits IA épuisés. Ajoutez des crédits à l'espace de travail.");
  }
  if (/quota|credit/i.test(raw)) {
    return new Error("Quota IA atteint. Réessayez plus tard.");
  }
  if (status === 401 || status === 403) {
    return new Error("Accès IA refusé. Réessayez.");
  }
  if (status === 429) {
    return new Error("Trop de requêtes IA en parallèle. Réessayez dans quelques secondes.");
  }
  if (error instanceof Error) return error;
  return new Error(raw || "Erreur IA inconnue");
}

const GradeSchema = z.object({
  verdict: z.enum(["correct", "partial", "incorrect"]),
  score: z.number(),
  feedback: z.string(),
});

const ExtractedQuestion = z.object({
  type: z.enum(["qcm", "qcs", "qroc"]),
  stem: z.string(),
  choices: z.array(z.string()).nullable(),
  correct_indices: z.array(z.number().int()).nullable(),
  model_answer: z.string().nullable(),
  explanation: z.string().nullable(),
  course_hint: z.string().nullable().optional(),
  year_hint: z.string().nullable().optional(),
  year_hints: z.array(z.string()).nullable().optional(),
  rotation_hint: z.string().nullable().optional(),
  rotation_hints: z.array(z.string()).nullable().optional(),
  detection_snippet: z.string().nullable().optional(),
  /** Common clinical vignette shared by a group of questions (cas clinique). */
  case_stem: z.string().nullable().optional(),
});
const ExtractSchema = z.object({
  questions: z.array(ExtractedQuestion),
  total_visible: z.number().int().min(0).max(200).nullable().optional(),
});
export type ExtractedQ = z.infer<typeof ExtractedQuestion>;

// ---- helpers ---------------------------------------------------------------

/** Extract the "Please retry in Ns" delay Google returns on 429, in ms. */
export function retryDelayMs(error: unknown, attempt: number): number {
  const raw = String((error as any)?.message ?? (error as any)?.responseBody ?? "");
  const m = raw.match(/retry in ([\d.]+)s/i);
  if (m) return Math.min(45_000, Math.ceil(parseFloat(m[1]) * 1000) + 500);
  return Math.min(20_000, 1500 * 2 ** attempt);
}

function errorStatus(error: unknown): number | undefined {
  const e = error as any;
  return e?.statusCode ?? e?.status ?? e?.response?.status ?? e?.cause?.statusCode;
}

/** 429 / 5xx are transient: worth waiting and retrying the same model. */
export function isTransient(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return /rate.?limit|overloaded|unavailable|RESOURCE_EXHAUSTED|timeout/i.test(
    String((error as any)?.message ?? ""),
  );
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type AiContent = Array<
  | { type: "text"; text: string }
  | { type: "image"; image: string }
  | { type: "file"; data: string; mediaType: string; filename?: string }
>;

/** Shared model-fallback + retry loop: tries each configured model in turn,
 *  retrying transient (429/5xx) errors with backoff and a schema miss once,
 *  before moving to the next candidate. Used by every structured AI call in
 *  this module so the retry policy lives in one place. */
async function generateWithFallback<T>(
  schema: z.ZodType<T>,
  content: AiContent,
  opts?: { temperature?: number; timeoutMs?: number; thinking?: boolean },
): Promise<{ output: T; engine: ExtractEngine }> {
  const candidates = await getExtractModelCandidates();
  if (!candidates.length) throw new Error("Moteur IA indisponible.");

  const attempt = async (model: any) => {
    const { output } = await generateText({
      model,
      output: Output.object({ schema }),
      abortSignal: AbortSignal.timeout(opts?.timeoutMs ?? 150_000),
      messages: [{ role: "user", content: content as any }],
      temperature: opts?.temperature ?? 0.2,
      ...(opts?.thinking
        ? { providerOptions: { google: { thinkingConfig: { thinkingLevel: "high" } } } }
        : {}),
    });
    return output;
  };

  let lastError: unknown = new Error("Aucun moteur IA configuré");

  for (const candidate of candidates) {
    // Up to 3 tries per model: transient 429/5xx get a real backoff (Google
    // tells us how long to wait), schema misses get one immediate retry.
    for (let attemptNo = 0; attemptNo < 3; attemptNo++) {
      try {
        const out = await attempt(candidate.model);
        return { output: out, engine: candidate.engine };
      } catch (error) {
        lastError = error;
        if (isTransient(error)) {
          if (attemptNo < 2) {
            await sleep(retryDelayMs(error, attemptNo));
            continue;
          }
          break;
        }
        if (NoObjectGeneratedError.isInstance(error) && attemptNo < 1) continue;
        break; // terminal for this model — try the next candidate
      }
    }
  }

  // Never resolve with an empty list pretending success: the caller must know.
  throw friendlyGatewayError(lastError);
}

async function runExtract(content: AiContent): Promise<ExtractResult> {
  const { output, engine } = await generateWithFallback(ExtractSchema, content, {
    temperature: 0.2,
    timeoutMs: 150_000,
    thinking: true,
  });
  return { ...normalizeQuestions(output), engine };
}

/** Word shading fills that are effectively "no highlight". */
function isWhiteFill(fill: string): boolean {
  const v = fill.toLowerCase();
  return v === "auto" || v === "ffffff" || v === "fffffe" || v === "fefefe";
}

/** Keep a Word run's color hint only when it carries a real accent color or highlight. */
function useRunColor(color?: string, shd?: string, highlight?: string): boolean {
  const hasColor = !!color && !isUnreadableOnDark(`#${color}`);
  const hasShd = !!shd && !isWhiteFill(shd);
  const hasHighlight = !!highlight && highlight !== "none";
  return hasColor || hasShd || hasHighlight;
}

/** Neutralize black text colors so imported content follows the app theme. */
function normalizeQuestions(result: { questions: ExtractedQ[]; total_visible?: number | null }): {
  questions: ExtractedQ[];
  total_visible?: number | null;
} {
  return {
    questions: (result.questions ?? []).map((q) => ({
      ...q,
      // Stems and choices keep the author's styling only — no auto vrai/faux
      // or option-letter coloring (that is reserved for explanations).
      stem: stripBold(stripImportedColors(q.stem ?? "")),
      choices: q.choices
        ? q.choices.map((c) => stripBold(stripImportedColors(c ?? "")))
        : q.choices,
      explanation: q.explanation
        ? normalizeInlineTextColors(splitPerOptionExplanation(q.explanation))
        : q.explanation,
      model_answer: q.model_answer ? normalizeInlineTextColors(q.model_answer) : q.model_answer,
    })),
    total_visible: result.total_visible ?? undefined,
  };
}

/**
 * If an explanation string bundles multiple per-option justifications inside a
 * single paragraph (e.g. "A. ... B) ... C - ..."), split them into a <ul> with
 * one <li> per option. Otherwise return the input unchanged.
 */
function splitPerOptionExplanation(html: string): string {
  if (!html) return html;
  // Only touch flat content: skip if it already contains a list or multiple blocks.
  if (/<(ul|ol|li|table|h[1-6])\b/i.test(html)) return html;
  const blocks = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi);
  const inner =
    blocks && blocks.length === 1
      ? blocks[0].replace(/^<p\b[^>]*>/i, "").replace(/<\/p>\s*$/i, "")
      : blocks && blocks.length > 1
        ? null
        : html;
  if (inner === null) return html;
  // Match markers like "A.", "A)", "A -", "A:" (letters A-H, case-insensitive)
  // that appear at start-of-string or right after whitespace/<br>.
  const markerRe = /(?:^|(?<=>|\s|\u00a0))([A-Ha-h])\s*[.)\-:]\s+/g;
  const positions: { idx: number; letter: string; end: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(inner)) !== null) {
    positions.push({
      idx: m.index + (m[0].length - m[0].trimStart().length),
      letter: m[1].toUpperCase(),
      end: markerRe.lastIndex,
    });
  }
  if (positions.length < 2) return html;
  const items: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i].end;
    const stop = i + 1 < positions.length ? positions[i + 1].idx : inner.length;
    const body = inner
      .slice(start, stop)
      .trim()
      .replace(/<br\s*\/?>\s*$/i, "");
    if (!body) continue;
    items.push(`<p><strong>${positions[i].letter}.</strong> ${body}</p>`);
  }
  if (items.length < 2) return html;
  // Separate each per-option explanation with a visible horizontal rule.
  return items.join("<hr />");
}

/**
 * Split a document body (Word HTML, or PDF text turned into HTML) into
 * per-question chunks carrying an expected count and the per-question
 * année/rotation/cours context read from the lines above each question.
 */
function prepareChunks(
  html: string,
  targetPerChunk: number,
  colorHintFor: (chunkHtml: string) => string,
  detectCases = true,
): PreparedChunk[] {
  const units = buildQuestionUnits(html, detectCases);
  if (units.length === 0) {
    // No question boundary detected at all — send the whole document as one
    // chunk with an unknown expected count rather than blind byte slicing.
    return [{ html, colorHint: colorHintFor(html), expected: 0, contexts: [], stems: [] }];
  }
  return chunkUnits(units, targetPerChunk, colorHintFor);
}

/**
 * Run the AI on one chunk and verify completeness: when fewer questions come
 * back than the chunk contains, re-split the chunk and retry the halves.
 */
/** Keep only the color hints whose exact text appears in this chunk. */
function filterColorHint(colorXmlHint: string, chunkHtml: string): string {
  if (!colorXmlHint) return "";
  const chunkText = chunkHtml.replace(/<[^>]+>/g, " ");
  return colorXmlHint
    .split("\n")
    .filter((line) => {
      const m = line.match(/^"([^"]+)"/);
      return m ? chunkText.includes(m[1]) : true;
    })
    .join("\n")
    .slice(0, 40_000);
}

/** Tell the model exactly how many questions it must return for this chunk. */
function expectedCountNote(expected: number): string {
  return expected > 0
    ? `IMPORTANT: ce extrait contient EXACTEMENT ${expected} question(s). Tu dois renvoyer les ${expected} questions, dans le même ordre, sans en omettre ni en fusionner aucune.`
    : "IMPORTANT: extrais TOUTES les questions présentes, dans l'ordre, sans en omettre aucune.";
}

async function extractChunkComplete(
  buildContent: (html: string, expected: number) => Parameters<typeof runExtract>[0],
  html: string,
  expected: number,
  depth = 0,
): Promise<ExtractResult> {
  const result = await runExtract(buildContent(html, expected));
  const got = result.questions.length;
  if (expected <= 0 || got >= expected || depth >= 2) {
    return {
      ...result,
      expected,
      warning:
        expected > 0 && got < expected
          ? `${expected} question(s) détectée(s) dans la source, ${got} extraite(s)`
          : undefined,
    };
  }

  // Shortfall: split this chunk in half and retry each half.
  const units = buildQuestionUnits(html);
  if (units.length < 2) {
    return { ...result, expected, warning: `${expected} attendue(s), ${got} extraite(s)` };
  }
  const mid = Math.ceil(units.length / 2);
  const halves = [units.slice(0, mid), units.slice(mid)];
  const parts = await Promise.all(
    halves.map((group) =>
      extractChunkComplete(
        buildContent,
        group.map((u) => u.html).join("\n"),
        group.length,
        depth + 1,
      ),
    ),
  );
  const questions = parts.flatMap((p) => p.questions);
  // Keep the better of the two attempts.
  if (questions.length <= got) {
    return { ...result, expected, warning: `${expected} attendue(s), ${got} extraite(s)` };
  }
  return {
    questions,
    engine: parts[0]?.engine ?? result.engine,
    expected,
    warning:
      questions.length < expected
        ? `${expected} attendue(s), ${questions.length} extraite(s)`
        : undefined,
  };
}

/** Split a base64 PDF (already a small chunk) into two base64 halves by page
 *  count, server-side. Mirrors fileUtils.ts's splitPdfIntoPageChunks (which
 *  is browser-only via btoa) but Buffer-based for use in a server function.
 *  Returns null when there's nothing left to split (< 2 pages). */
async function splitPdfBase64InHalf(base64: string): Promise<[string, string] | null> {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(Buffer.from(base64, "base64"));
  const pageCount = src.getPageCount();
  if (pageCount < 2) return null;
  const mid = Math.ceil(pageCount / 2);
  const ranges: [number, number][] = [
    [0, mid],
    [mid, pageCount],
  ];
  const halves = await Promise.all(
    ranges.map(async ([start, end]) => {
      const indices = Array.from({ length: end - start }, (_, k) => start + k);
      const sub = await PDFDocument.create();
      (await sub.copyPages(src, indices)).forEach((p) => sub.addPage(p));
      return Buffer.from(await sub.save()).toString("base64");
    }),
  );
  return [halves[0], halves[1]];
}

/**
 * PDF equivalent of extractChunkComplete: an image-based PDF chunk has no
 * text layer to compute a real expected count from, so completeness is
 * checked against the model's own self-reported total_visible instead (a
 * soft heuristic, not a hard fact — it can be wrong in either direction).
 * On a shortfall, re-split the chunk by page count (not by parsed text
 * units) and retry the halves, keeping whichever attempt found more.
 */
async function extractPdfChunkComplete(
  buildContent: (base64: string) => Parameters<typeof runExtract>[0],
  base64: string,
  priorExpected: number,
  depth = 0,
): Promise<ExtractResult> {
  const result = await runExtract(buildContent(base64));
  const got = result.questions.length;
  const target = priorExpected > 0 ? priorExpected : (result.total_visible ?? 0);

  if (target <= 0 || got >= target || depth >= 2) {
    return {
      ...result,
      expected: target || undefined,
      warning:
        target > 0 && got < target
          ? `${target} question(s) détectée(s) par l'IA, ${got} extraite(s)`
          : undefined,
    };
  }

  const halves = await splitPdfBase64InHalf(base64);
  if (!halves) {
    return {
      ...result,
      expected: target,
      warning: `${target} question(s) détectée(s) par l'IA, ${got} extraite(s) (page unique, non re-scindable)`,
    };
  }

  const parts = await Promise.all(
    halves.map((half) => extractPdfChunkComplete(buildContent, half, 0, depth + 1)),
  );
  const questions = parts.flatMap((p) => p.questions);
  if (questions.length <= got) {
    return {
      ...result,
      expected: target,
      warning: `${target} question(s) détectée(s) par l'IA, ${got} extraite(s)`,
    };
  }
  return {
    questions,
    engine: parts[0]?.engine ?? result.engine,
    expected: target,
    warning:
      questions.length < target
        ? `${target} question(s) détectée(s) par l'IA, ${questions.length} extraite(s)`
        : undefined,
  };
}

const INSTRUCTIONS = (hint?: string, detectCases = true, askTotalVisible = false) =>
  [
    "Tu extrais des questions de QCM médicales à partir d'un document (capture d'écran, PDF, ou texte extrait d'un fichier Word), en français ou en arabe.",
    "Le fragment fourni contient un ou plusieurs QCM. N'en oublie aucun, ne fusionne pas deux questions, et ne réinvente rien.",
    askTotalVisible
      ? "Avant de répondre, compte silencieusement le nombre total de questions DISTINCTES visibles dans ce document/extrait (chaque QCM/QCS/QROC numéroté ou clairement séparé compte pour une). Renvoie ce total dans le champ total_visible, et assure-toi ensuite que la longueur du tableau questions est EXACTEMENT égale à total_visible : n'en omets, ne fusionne, ni ne dédouble aucune."
      : "",
    "Pour chaque question visible, retourne:",
    "- type: 'qcs' si une seule bonne réponse, 'qcm' si plusieurs, 'qroc' si question ouverte sans choix.",
    "- stem: l'énoncé exact.",
    "- choices: la liste des propositions (A, B, C, ...) SANS la lettre en préfixe. null pour qroc.",
    "- correct_indices: indices (0-based) des bonnes réponses si visibles/soulignées/cochées/indiquées comme correction, sinon null. Dans une capture d'écran de quiz, la bonne réponse est souvent toute la ligne surlignée (ex: en vert), parfois accompagnée d'un pourcentage de réponses (ex: '73%') à côté — ce pourcentage est une statistique d'interface: ignore-le, ne l'inclus jamais dans le texte d'une proposition, et ne l'utilise que le surlignage/couleur comme signal de bonne réponse.",
    "- Certains QCM affichent d'abord une liste NUMÉROTÉE d'items (1, 2, 3…) puis des propositions LETTRÉES qui combinent ces numéros (ex: A. '1+2', B. '3+4'). Dans ce cas: garde la liste numérotée dans stem (à la suite de l'énoncé), et mets dans choices le texte EXACT de chaque combinaison lettrée (ex: '1+2', '3+4') sans l'expliciter ni la reformuler.",
    "- model_answer: réponse attendue pour qroc, sinon null.",
    "- explanation: correction/justification si présente, sinon null. Si la zone de correction n'affiche qu'un texte de remplacement générique sans contenu réel (ex: 'Corrigé type') et rien d'autre après, c'est qu'il n'y a pas d'explication: explanation = null, ne recopie jamais ce texte de remplacement. Renvoie du HTML si la source contient de la mise en forme: conserve <strong>, <em>, <u>, listes <ul>/<ol>/<li>, titres <h3>/<h4>, tableaux <table><tr><td>…</td></tr></table>, images <img src=\"…\"> (recopie l'URL exacte, ne l'invente pas). Ne renvoie PAS de balises <html>, <body>, <script>, <style>, ni d'attributs onclick.",
    "- MISE EN FORME OBLIGATOIRE de explanation quand elle couvre plusieurs propositions: retourne une liste HTML <ul><li><strong>A.</strong> …</li><li><strong>B.</strong> …</li>…</ul>, une <li> par proposition, JAMAIS plusieurs justifications collées dans un même <p>. Si l'explication est unique et globale (pas ventilée par option), garde un simple <p>.",
    "- Dans stem et choices, N'UTILISE JAMAIS de gras: pas de <strong>, pas de <b>, pas de font-weight. Tu peux conserver <em>, <u>, tableaux <table>, images <img src=\"…\"> si présents dans la source. Ne modifie JAMAIS l'URL d'une <img>: recopie l'attribut src verbatim (y compris les URLs commençant par storage://).",
    "Pour les PDF et les images: encode l'italique, le souligné et les listes en HTML (<em>, <u>, <ul>/<ol>/<li>), mais jamais le gras dans stem/choices. Conserve la structure des tableaux avec <table><tr><td>. Ne produis aucune balise <html>, <body>, <script>, <style>, ni d'attribut onclick.",
    "- Si une image ou un tableau se trouve à l'intérieur d'un énoncé, d'une proposition ou d'une explication, place-le dans le champ correspondant (stem/choices[i]/explanation) au bon endroit.",
    "- course_hint: nom du cours/chapitre visible en en-tête ou dans un titre (ex: 'Cardiologie – Insuffisance cardiaque'), sinon null.",
    "- year_hint: année d'études visible sur le document (ex: '3ème année', 'DCEM2', '4A', 'PS 2020'), sinon null.",
    "- rotation_hint: période/rotation visible (ex: 'P1 2026', 'Résidanat 2024', 'Rotation 2', 'Externat Alger'), sinon null.",
    "Ces métadonnées (cours, rotation, année) apparaissent parfois sous forme de plusieurs petites étiquettes/badges courts en haut de la capture (ex: 'Pneumologie', 'Externat Alger', 'PS 2020') plutôt que dans une phrase — lis-les telles quelles et associe chacune au champ approprié (course_hint pour le cours/sujet, rotation_hint pour la session/cohorte, year_hint pour l'année).",
    detectCases
      ? "- case_stem: CAS CLINIQUES. Si plusieurs questions consécutives partagent un même énoncé/vignette clinique (observation d'un patient suivie de plusieurs questions), recopie ce texte commun À L'IDENTIQUE dans case_stem pour CHACUNE de ces questions, et NE le répète PAS dans leur champ stem (stem = uniquement la question elle-même). Pour une question isolée, case_stem = null."
      : "- case_stem: laisse TOUJOURS ce champ à null. Ne détecte ni ne regroupe aucun cas clinique, même si plusieurs questions semblent partager un énoncé commun — traite chaque question comme indépendante.",
    detectCases
      ? 'Si un paragraphe <p data-doc-intro="1">…</p> précède les questions, c\'est probablement une vignette clinique partagée par les questions de cet extrait (même sans étiquette "Cas clinique"): si c\'est bien le cas, recopie CE TEXTE À L\'IDENTIQUE (verbatim, sans le paraphraser) dans case_stem pour chaque question concernée, exactement comme pour un cas clinique explicite.'
      : "",
    'IMPORTANT couleurs: PRÉSERVE fidèlement les couleurs et surlignages (highlighter) présents dans la source. Encode-les en HTML: <span style="color:#RRGGBB">…</span> pour les couleurs de texte et <span style="background-color:#RRGGBB">…</span> pour les surlignages/highlighter. Si le fragment `colorHint` est fourni ci-dessous, applique ces styles exacts autour des fragments de texte listés.',
    "Respecte l'ordre d'apparition des questions dans le document.",
    hint ? `Contexte fourni par l'admin: ${hint}` : "",
    "Ignore les éléments d'interface (boutons, menus, chrono, numéros de page). Ne rien inventer: si un champ n'est pas visible, mettre null.",
  ]
    .filter(Boolean)
    .join("\n");

/**
 * Convert a DOCX buffer to HTML while uploading every inline image to the
 * `explanation-images` storage bucket. The returned HTML references the
 * uploaded assets via `storage://explanation-images/<path>` URIs which the
 * <RichText> renderer resolves to signed URLs at display time.
 */
async function docxToHtmlWithImages(buffer: Buffer, userId: string): Promise<string> {
  const mammoth = await import("mammoth");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const styleMap = [
    "b => strong",
    "i => em",
    "u => u",
    "p[style-name='Heading 1'] => h3:fresh",
    "p[style-name='Heading 2'] => h4:fresh",
    "p[style-name='Titre 1'] => h3:fresh",
    "p[style-name='Titre 2'] => h4:fresh",
  ];

  const uploadedByHash = new Map<string, string>();
  const convertImage = (mammoth as any).images.imgElement(async (image: any) => {
    try {
      const b64: string = await image.read("base64");
      const contentType: string = image.contentType || "image/png";
      // Dedupe identical images by hash of their bytes.
      const crypto = await import("node:crypto");
      const hash = crypto.createHash("sha1").update(b64).digest("hex");
      const cached = uploadedByHash.get(hash);
      if (cached) return { src: cached };
      const ext =
        contentType
          .split("/")[1]
          ?.replace("jpeg", "jpg")
          .replace(/[^a-z0-9]/gi, "") || "png";
      const path = `imports/${userId}/${Date.now()}-${hash.slice(0, 12)}.${ext}`;
      const bytes = Buffer.from(b64, "base64");
      const { error } = await supabaseAdmin.storage
        .from("explanation-images")
        .upload(path, bytes, { contentType, upsert: false });
      if (error && !/already exists/i.test(error.message)) {
        // Fallback to inline data URL so nothing is lost visually.
        const dataUrl = `data:${contentType};base64,${b64}`;
        uploadedByHash.set(hash, dataUrl);
        return { src: dataUrl };
      }
      const src = `storage://explanation-images/${path}`;
      uploadedByHash.set(hash, src);
      return { src };
    } catch {
      return { src: "" };
    }
  });

  const result = await mammoth.convertToHtml({ buffer }, { styleMap, convertImage } as any);
  return (result.value ?? "").trim();
}

export const extractQuestionsFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        imageDataUrl: z
          .string()
          .max(15_000_000)
          .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i, "Image invalide"),
        hint: z.string().max(500).optional(),
        detectCases: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    return runExtract([
      { type: "text", text: INSTRUCTIONS(data.hint, data.detectCases ?? true) },
      { type: "image", image: data.imageDataUrl },
    ]);
  });

export const extractQuestionsFromPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pdfDataUrl: z
          .string()
          .max(25_000_000)
          .regex(/^data:application\/pdf;base64,/i, "PDF invalide"),
        filename: z.string().max(200).optional(),
        hint: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = data.pdfDataUrl.replace(/^data:application\/pdf;base64,/i, "");
    return runExtract([
      { type: "text", text: INSTRUCTIONS(data.hint) },
      {
        type: "file",
        data: base64,
        mediaType: "application/pdf",
        filename: data.filename ?? "document.pdf",
      },
    ]);
  });

export const extractQuestionsFromDocx = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        docxDataUrl: z
          .string()
          .max(25_000_000)
          .regex(
            /^data:(application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/octet-stream);base64,/i,
            "DOCX invalide",
          ),
        hint: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = data.docxDataUrl.replace(/^data:[^;]+;base64,/i, "");
    const buffer = Buffer.from(base64, "base64");

    let html = "";
    let colorXmlHint = "";
    try {
      // Convert to HTML so bold/italic/headers/lists/tables/images survive.
      html = await docxToHtmlWithImages(buffer, context.userId);

      // mammoth drops font colors — extract them from document.xml so Gemini
      // can re-inject <span style="color:#..."> where needed.
      try {
        const JSZip = (await import("jszip")).default;
        const zip = await JSZip.loadAsync(buffer);
        const docXml = await zip.file("word/document.xml")?.async("string");
        if (docXml) {
          const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
          const parts: string[] = [];
          for (const run of docXml.match(runRe) ?? []) {
            const color = run.match(/<w:color\s+[^>]*w:val="([0-9A-Fa-f]{6})"/)?.[1];
            const highlight = run.match(/<w:highlight\s+[^>]*w:val="([^"]+)"/)?.[1];
            const shd = run.match(/<w:shd\s+[^>]*w:fill="([0-9A-Fa-f]{6})"/)?.[1];
            if (!useRunColor(color, shd, highlight)) continue;
            const text = Array.from(run.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
              .map((m) => m[1])
              .join("")
              .trim();
            if (!text) continue;
            const style: string[] = [];
            if (color && !isUnreadableOnDark(`#${color}`)) style.push(`color:#${color}`);
            if (shd && !isWhiteFill(shd)) style.push(`background-color:#${shd}`);
            if (highlight && highlight !== "none" && (!shd || isWhiteFill(shd)))
              style.push(`background-color:${highlight}`);
            if (!style.length) continue;
            if (!style.length) continue;
            parts.push(`${JSON.stringify(text)} -> ${style.join(";")}`);
          }
          if (parts.length) {
            colorXmlHint =
              'Mise en forme couleur détectée dans la source (à réinjecter en <span style="...">…</span> autour de ces fragments exacts):\n' +
              parts.slice(0, 400).join("\n");
          }
        }
      } catch {
        // ignore color extraction failures
      }
    } catch (e: any) {
      throw new Error("Lecture du document Word impossible: " + (e?.message ?? "erreur"));
    }
    if (!html) return { questions: [] as ExtractedQ[], engine: "local" as ExtractEngine };

    // Split into per-question chunks and run in parallel.
    const chunks = prepareChunks(html, 8, (c) => filterColorHint(colorXmlHint, c));
    const results = await Promise.all(
      chunks.map((chunk) =>
        extractChunkComplete(
          (chunkHtml, expected) => [
            { type: "text", text: INSTRUCTIONS(data.hint) },
            { type: "text", text: expectedCountNote(expected) },
            {
              type: "text",
              text:
                "HTML extrait du document Word (conserve la mise en forme dans stem/choices/explanation):\n\n" +
                chunkHtml.slice(0, 80_000),
            },
            ...(chunk.colorHint ? [{ type: "text" as const, text: chunk.colorHint }] : []),
          ],
          chunk.html,
          chunk.expected,
        ),
      ),
    );
    return {
      questions: results.flatMap((r: ExtractResult) => r.questions),
      engine: (results[0]?.engine ?? "local") as ExtractEngine,
    };
  });

// ---- new fast/parallel API ------------------------------------------------

/**
 * Server-side DOCX preprocessor: converts to HTML, extracts color hints, and
 * returns question-sized chunks. The client then fires each chunk in parallel
 * through `extractQuestionsFromHtmlChunk`.
 */
export const prepareDocxChunks = createServerFn({ method: "POST" })
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
        questionsPerChunk: z.number().int().min(1).max(30).optional(),
        detectCases: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = data.docxDataUrl.replace(/^data:[^;]+;base64,/i, "");
    const buffer = Buffer.from(base64, "base64");
    const html = await docxToHtmlWithImages(buffer, context.userId);

    let colorXmlHint = "";
    try {
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(buffer);
      const docXml = await zip.file("word/document.xml")?.async("string");
      if (docXml) {
        const runRe = /<w:r\b[^>]*>[\s\S]*?<\/w:r>/g;
        const parts: string[] = [];
        for (const run of docXml.match(runRe) ?? []) {
          const color = run.match(/<w:color\s+[^>]*w:val="([0-9A-Fa-f]{6})"/)?.[1];
          const highlight = run.match(/<w:highlight\s+[^>]*w:val="([^"]+)"/)?.[1];
          const shd = run.match(/<w:shd\s+[^>]*w:fill="([0-9A-Fa-f]{6})"/)?.[1];
          if (!useRunColor(color, shd, highlight)) continue;
          const text = Array.from(run.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
            .map((m) => m[1])
            .join("")
            .trim();
          if (!text) continue;
          const style: string[] = [];
          if (color && !isUnreadableOnDark(`#${color}`)) style.push(`color:#${color}`);
          if (shd && !isWhiteFill(shd)) style.push(`background-color:#${shd}`);
          if (highlight && highlight !== "none" && (!shd || isWhiteFill(shd)))
            style.push(`background-color:${highlight}`);
          if (!style.length) continue;
          parts.push(`${JSON.stringify(text)} -> ${style.join(";")}`);
        }
        if (parts.length) {
          colorXmlHint =
            'Mise en forme couleur détectée dans la source (à réinjecter en <span style="...">…</span> autour de ces fragments exacts):\n' +
            parts.slice(0, 800).join("\n");
        }
      }
    } catch {
      // ignore
    }

    if (!html) return { chunks: [] as PreparedChunk[], totalExpected: 0 };
    const chunks = prepareChunks(
      html,
      data.questionsPerChunk ?? 4,
      (c) => filterColorHint(colorXmlHint, c),
      data.detectCases ?? true,
    );
    return { chunks, totalExpected: chunks.reduce((s, c) => s + c.expected, 0) };
  });

/**
 * Prepare chunks from already-extracted plain text (PDF text layer read in the
 * browser). Avoids re-uploading the PDF binary for every chunk.
 */
export const prepareTextChunks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        text: z.string().max(4_000_000),
        questionsPerChunk: z.number().int().min(1).max(30).optional(),
        detectCases: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const html = textToHtml(data.text);
    if (!html) return { chunks: [] as PreparedChunk[], totalExpected: 0 };
    const chunks = prepareChunks(
      html,
      data.questionsPerChunk ?? 4,
      () => "",
      data.detectCases ?? true,
    );
    return { chunks, totalExpected: chunks.reduce((s, c) => s + c.expected, 0) };
  });

/** Extract questions from a single HTML chunk (DOCX pipeline). */
export const extractQuestionsFromHtmlChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        html: z.string().max(200_000),
        colorHint: z.string().max(60_000).optional(),
        hint: z.string().max(500).optional(),
        expected: z.number().int().min(0).max(200).optional(),
        allowNoAi: z.boolean().optional(),
        detectCases: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    if (data.allowNoAi) {
      // Zero-credit path: rules-based local parsing, no AI call at all.
      const { questions } = normalizeQuestions({
        questions: parseQuestionsLocally(data.html) as ExtractedQ[],
      });
      const expected = data.expected ?? 0;
      return {
        questions,
        engine: "local" as ExtractEngine,
        expected,
        warning:
          expected > 0 && questions.length < expected
            ? `${expected} question(s) détectée(s), ${questions.length} lue(s) par le mode sans IA`
            : undefined,
      } satisfies ExtractResult;
    }
    return extractChunkComplete(
      (chunkHtml, expected) => [
        { type: "text", text: INSTRUCTIONS(data.hint, data.detectCases ?? true) },
        { type: "text", text: expectedCountNote(expected) },
        {
          type: "text",
          text:
            "Contenu extrait du document (conserve la mise en forme dans stem/choices/explanation):\n\n" +
            chunkHtml,
        },
        ...(data.colorHint ? [{ type: "text" as const, text: data.colorHint }] : []),
      ],
      data.html,
      data.expected ?? 0,
    );
  });

/** Extract questions from a single PDF chunk (already split client-side). */
export const extractQuestionsFromPdfChunk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        pdfDataUrl: z
          .string()
          .max(15_000_000)
          .regex(/^data:application\/pdf;base64,/i, "PDF invalide"),
        filename: z.string().max(200).optional(),
        hint: z.string().max(500).optional(),
        expected: z.number().int().min(0).max(200).optional(),
        detectCases: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = data.pdfDataUrl.replace(/^data:application\/pdf;base64,/i, "");
    return extractPdfChunkComplete(
      (chunkBase64) => [
        { type: "text", text: INSTRUCTIONS(data.hint, data.detectCases ?? true, true) },
        { type: "text", text: expectedCountNote(data.expected ?? 0) },
        {
          type: "file",
          data: chunkBase64,
          mediaType: "application/pdf",
          filename: data.filename ?? "chunk.pdf",
        },
      ],
      base64,
      data.expected ?? 0,
    );
  });

const RotationYearSchema = z.object({
  rotation: z.string().nullable().optional(),
  year: z.string().nullable().optional(),
});

/** Read only the rotation/année header shown at the top of a screenshot —
 *  a narrower, cheaper task than full question extraction, meant to be
 *  reviewed/corrected before being applied in bulk onto already-extracted
 *  questions. Takes a pre-cropped image of just the top of the page (see
 *  `renderPdfPageTopImages` in `src/lib/pdfText.ts`) rather than the whole
 *  PDF page — a whole-page render makes the small header text illegible to
 *  the model, while a cropped, high-resolution top strip reads reliably. */
export const extractRotationYearFromImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        imageDataUrl: z
          .string()
          .max(5_000_000)
          .regex(/^data:image\//i, "Image invalide"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const { output } = await generateWithFallback(
      RotationYearSchema,
      [
        {
          type: "text",
          text:
            `Voici le haut d'une capture d'écran de question médicale (recadré). Il ` +
            `contient normalement un en-tête indiquant la rotation et/ou l'année, sous ` +
            `forme d'une ligne de texte (ex: "P3 2024", "Rotation 2 - 2023/2024", "R4") ` +
            `ou de petites étiquettes/badges séparés (ex: "Externat Alger", "PS 2020"). ` +
            `Lis UNIQUEMENT cet en-tête. Si l'en-tête n'est pas visible sur cette image, ` +
            `renvoie rotation et year à null — ne devine jamais.`,
        },
        { type: "image", image: data.imageDataUrl },
      ],
      { temperature: 0.1, timeoutMs: 60_000 },
    );
    return {
      rotation: output.rotation?.trim() || null,
      year: output.year?.trim() || null,
    };
  });

/** Health check for the admin panel: pings each built-in model candidate. */
export const testGoogleAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");

    const candidates = await getExtractModelCandidates();
    type Row = {
      model: string;
      engine: string;
      ok: boolean;
      latencyMs: number;
      reply?: string;
      error?: string;
    };
    if (!candidates.length) {
      return {
        ok: false,
        models: [] as Row[],
        message: "Moteur IA indisponible.",
      };
    }

    const models: Row[] = [];
    for (const candidate of candidates) {
      const name = String((candidate.model as any)?.modelId ?? "gemini");
      const engine = "IA intégrée";
      const started = Date.now();
      try {
        const { text } = await generateText({
          model: candidate.model,
          abortSignal: AbortSignal.timeout(20_000),
          prompt: "Réponds exactement par: OK",
        });
        models.push({
          model: name,
          engine,
          ok: true,
          latencyMs: Date.now() - started,
          reply: text.trim().slice(0, 40),
        });
      } catch (error) {
        models.push({
          model: name,
          engine,
          ok: false,
          latencyMs: Date.now() - started,
          error: friendlyGatewayError(error).message.slice(0, 300),
        });
      }
    }

    const ok = models.some((m) => m.ok);
    return {
      ok,
      models,
      message: ok
        ? `Moteur d'extraction actif : ${models.find((m) => m.ok)!.model} (${models.find((m) => m.ok)!.engine})`
        : "Aucun modèle ne répond (quota, accès ou modèle indisponible).",
    };
  });

export const gradeQrocAnswer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        sessionId: z.string().uuid(),
        questionId: z.string().uuid(),
        userAnswer: z.string().min(1).max(4000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: question, error: qErr } = await supabase
      .from("questions")
      .select("id, stem, model_answer, explanation, type")
      .eq("id", data.questionId)
      .maybeSingle();
    if (qErr) throw new Error(qErr.message);
    if (!question) throw new Error("Question introuvable");

    const { data: session, error: sErr } = await supabase
      .from("qcm_sessions")
      .select("id, user_id, grades")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!session || session.user_id !== userId) throw new Error("Session introuvable");

    const candidates = await getExtractModelCandidates();
    if (!candidates.length) throw new Error("Aucune clé IA configurée");
    const model = candidates[0].model;

    const prompt = [
      "Tu es un correcteur médical bienveillant. Corrige la réponse de l'étudiant à cette QROC en français.",
      `Question: ${question.stem}`,
      `Réponse attendue (référence): ${question.model_answer ?? "(non fournie)"}`,
      `Réponse de l'étudiant: ${data.userAnswer}`,
      "Renvoie: verdict (correct/partial/incorrect), score entre 0 et 1, feedback court (2-3 phrases) qui explique ce qui manque ou ce qui est faux.",
    ].join("\n");

    let grade: z.infer<typeof GradeSchema>;
    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: GradeSchema }),
        prompt,
      });
      grade = output;
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) {
        grade = {
          verdict: "partial",
          score: 0.5,
          feedback: "Correction automatique indisponible. Vérifiez avec la réponse attendue.",
        };
      } else {
        throw error;
      }
    }
    grade.score = Math.max(0, Math.min(1, grade.score));

    const nextGrades = {
      ...((session.grades as Record<string, unknown>) ?? {}),
      [data.questionId]: { ...grade, userAnswer: data.userAnswer },
    };
    const { error: upErr } = await supabase
      .from("qcm_sessions")
      .update({ grades: nextGrades as any })
      .eq("id", data.sessionId);
    if (upErr) throw new Error(upErr.message);

    return grade;
  });
