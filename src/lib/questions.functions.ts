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
import { generateWithFallback, friendlyGatewayError, type AiContent } from "./aiGenerate.server";
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
  /** Set when this question continues a clinical case whose vignette started
   *  on an earlier page, so the client can carry that vignette forward even
   *  if the model could not recopy it. */
  continues_previous_page: z.boolean().nullable().optional(),
});
const ExtractSchema = z.object({
  questions: z.array(ExtractedQuestion),
  total_visible: z.number().int().min(0).max(200).nullable().optional(),
});
export type ExtractedQ = z.infer<typeof ExtractedQuestion>;

// ---- helpers ---------------------------------------------------------------

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
    ? `IMPORTANT: cet extrait contient EXACTEMENT ${expected} question(s). Tu dois renvoyer les ${expected} questions, dans le même ordre, sans en omettre ni en fusionner aucune.`
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
 * soft heuristic, not a hard fact — it can be wrong in either direction),
 * unless the caller could derive a real count from the page's text layer.
 * On a shortfall, re-split the chunk by page count (not by parsed text
 * units) and retry the halves, keeping whichever attempt found more.
 *
 * `buildContent` takes the expected count for THAT level: a half-chunk must
 * never be told the whole chunk's count, or the model pads or duplicates to
 * reach a number that was never in front of it.
 */
async function extractPdfChunkComplete(
  buildContent: (base64: string, expected: number) => Parameters<typeof runExtract>[0],
  base64: string,
  priorExpected: number,
  depth = 0,
): Promise<ExtractResult> {
  const result = await runExtract(buildContent(base64, priorExpected));
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

const INSTRUCTIONS = (
  hint?: string,
  detectCases = true,
  askTotalVisible = false,
  contextPages = 0,
) =>
  [
    "Tu extrais des questions de QCM médicales à partir d'un document (capture d'écran, PDF, ou texte extrait d'un fichier Word), en français ou en arabe.",
    "Le fragment fourni contient un ou plusieurs QCM. N'en oublie aucun, ne fusionne pas deux questions, et ne réinvente rien.",
    contextPages > 0
      ? `ATTENTION — PAGES DE CONTEXTE: ce PDF contient ${contextPages + 1} page(s), mais tu ne dois extraire QUE les questions de la DERNIÈRE page. ${contextPages === 1 ? "La page précédente est" : "Les pages précédentes sont"} fournie(s) UNIQUEMENT comme contexte: n'en extrais AUCUNE question, même complète. Ce contexte sert à une seule chose: si la dernière page commence par des questions qui poursuivent un cas clinique (vignette/observation) commencé sur la page précédente, tu dois recopier cette vignette À L'IDENTIQUE dans leur champ case_stem, et mettre continues_previous_page à true pour ces questions-là.`
      : "",
    askTotalVisible
      ? `Avant de répondre, compte silencieusement le nombre total de questions DISTINCTES visibles ${contextPages > 0 ? "SUR LA DERNIÈRE PAGE UNIQUEMENT (ignore complètement les questions des pages de contexte dans ce comptage)" : "dans ce document/extrait"} (chaque QCM/QCS/QROC numéroté ou clairement séparé compte pour une). Renvoie ce total dans le champ total_visible, et assure-toi ensuite que la longueur du tableau questions est EXACTEMENT égale à total_visible : n'en omets, ne fusionne, ni ne dédouble aucune.`
      : "",
    "Pour chaque question visible, retourne:",
    "- type: 'qcs' si une seule bonne réponse, 'qcm' si plusieurs, 'qroc' si question ouverte sans choix.",
    "- stem: l'énoncé exact.",
    "- choices: la liste des propositions (A, B, C, ...) SANS la lettre en préfixe. null pour qroc.",
    "- correct_indices: indices (0-based) des bonnes réponses si visibles/soulignées/cochées/indiquées comme correction, sinon null. Dans une capture d'écran de quiz, la bonne réponse est souvent toute la ligne surlignée (ex: en vert), parfois accompagnée d'un pourcentage de réponses (ex: '73%') à côté — ce pourcentage est une statistique d'interface: ignore-le, ne l'inclus jamais dans le texte d'une proposition, et ne l'utilise que le surlignage/couleur comme signal de bonne réponse.",
    "IMPORTANT ET OBLIGATOIRE — listes numérotées + choix combinés: certains QCM affichent d'abord une liste NUMÉROTÉE d'items (1, 2, 3…) puis des propositions LETTRÉES qui combinent ces numéros (ex: A. '1+2', B. '3+4'). Dans ce cas, tu DOIS recopier la liste numérotée ENTIÈRE (chaque item avec son texte complet) à la suite de la question dans stem — NE L'OMETS JAMAIS, même si elle te semble redondante avec les propositions lettrées. Exemple de stem attendu: 'Associer les éléments sous-jacents qui expliquent les signes ci-dessous :\\n1. FNS + groupage\\n2. Examen des crachats à la recherche de BK\\n3. CRP\\n4. Bilan d'hémostase\\n5. D-dimères'. Mets ensuite dans choices UNIQUEMENT le texte de chaque combinaison lettrée (ex: '1+2', '1, 2'), tel qu'affiché, sans le développer ni le reformuler.",
    "- model_answer: réponse attendue pour qroc, sinon null.",
    "- explanation: correction/justification si présente, sinon null. Si la zone de correction n'affiche qu'un texte de remplacement générique sans contenu réel (ex: 'Corrigé type') et rien d'autre après, c'est qu'il n'y a pas d'explication: explanation = null, ne recopie jamais ce texte de remplacement. Renvoie du HTML si la source contient de la mise en forme: conserve <strong>, <em>, <u>, listes <ul>/<ol>/<li>, titres <h3>/<h4>, tableaux <table><tr><td>…</td></tr></table>, images <img src=\"…\"> (recopie l'URL exacte, ne l'invente pas). Ne renvoie PAS de balises <html>, <body>, <script>, <style>, ni d'attributs onclick.",
    "- MISE EN FORME OBLIGATOIRE de explanation quand elle couvre plusieurs propositions: retourne une liste HTML <ul><li><strong>A.</strong> …</li><li><strong>B.</strong> …</li>…</ul>, une <li> par proposition, JAMAIS plusieurs justifications collées dans un même <p>. Si l'explication est unique et globale (pas ventilée par option), garde un simple <p>.",
    "- Dans stem et choices, N'UTILISE JAMAIS de gras: pas de <strong>, pas de <b>, pas de font-weight. Tu peux conserver <em>, <u>, tableaux <table>, images <img src=\"…\"> si présents dans la source. Ne modifie JAMAIS l'URL d'une <img>: recopie l'attribut src verbatim (y compris les URLs commençant par storage://).",
    "Pour les PDF et les images: encode l'italique, le souligné et les listes en HTML (<em>, <u>, <ul>/<ol>/<li>), mais jamais le gras dans stem/choices. Conserve la structure des tableaux avec <table><tr><td>. Ne produis aucune balise <html>, <body>, <script>, <style>, ni d'attribut onclick.",
    "- Si une image ou un tableau se trouve à l'intérieur d'un énoncé, d'une proposition ou d'une explication, place-le dans le champ correspondant (stem/choices[i]/explanation) au bon endroit.",
    "- course_hint: nom du cours/chapitre visible en en-tête ou dans un titre (ex: 'Cardiologie – Insuffisance cardiaque'), sinon null.",
    "- year_hint: année d'études visible sur le document (ex: '3ème année', 'DCEM2', '4A', 'PS 2020'), sinon null.",
    "- rotation_hint: UNIQUEMENT un code de rotation/session (ex: 'P1', 'P3 2026', 'Résidanat 2024', 'Rotation 2', 'Rattrapage 2024'), sinon null. Ce n'est JAMAIS un nom d'institution, de ville ou de faculté (ex: 'Externat Alger', 'CHU Alger') ni un titre de cours/document — ce genre de texte va dans course_hint, pas rotation_hint, et si aucun champ ne convient, ignore-le simplement.",
    "Ces métadonnées (cours, rotation, année) apparaissent parfois sous forme de plusieurs petites étiquettes/badges courts en haut de la capture (ex: 'Pneumologie', 'P3', 'PS 2020') plutôt que dans une phrase — lis-les telles quelles et associe chacune au champ approprié (course_hint pour le cours/sujet ou l'institution, rotation_hint UNIQUEMENT pour un vrai code de rotation/session, year_hint pour l'année).",
    detectCases
      ? "- case_stem: CAS CLINIQUES. Si plusieurs questions consécutives partagent un même énoncé/vignette clinique (observation d'un patient suivie de plusieurs questions), recopie ce texte commun À L'IDENTIQUE dans case_stem pour CHACUNE de ces questions, et NE le répète PAS dans leur champ stem (stem = uniquement la question elle-même). Pour une question isolée, case_stem = null."
      : "",
    detectCases
      ? "- continues_previous_page: mets true UNIQUEMENT pour les toutes premières questions de l'extrait lorsqu'elles poursuivent visiblement un cas clinique dont la vignette n'apparaît PAS en entier ici (elle a commencé sur une page précédente) — par exemple une page qui démarre directement par « 3. » ou « Question 4 » d'une série liée à une observation absente. Pour toutes les autres questions, laisse ce champ à false ou null. Ne l'utilise jamais pour une question indépendante."
      : "- case_stem: laisse TOUJOURS ce champ à null. Ne détecte ni ne regroupe aucun cas clinique, même si plusieurs questions semblent partager un énoncé commun — traite chaque question comme indépendante.",
    detectCases
      ? 'Si un paragraphe <p data-doc-intro="1">…</p> précède les questions, c\'est probablement une vignette clinique partagée par les questions de cet extrait (même sans étiquette "Cas clinique"): si c\'est bien le cas, recopie CE TEXTE À L\'IDENTIQUE (verbatim, sans le paraphraser) dans case_stem pour chaque question concernée, exactement comme pour un cas clinique explicite.'
      : "",
    'IMPORTANT couleurs: PRÉSERVE fidèlement les couleurs et surlignages (highlighter) présents dans la source. Encode-les en HTML: <span style="color:#RRGGBB">…</span> pour les couleurs de texte et <span style="background-color:#RRGGBB">…</span> pour les surlignages/highlighter. Si le fragment `colorHint` est fourni ci-dessous, applique ces styles exacts autour des fragments de texte listés.',
    "Respecte STRICTEMENT l'ordre d'apparition des questions dans le document. Si la page a une mise en page à plusieurs colonnes, lis la colonne de gauche EN ENTIER de haut en bas AVANT de passer à la colonne de droite — ne mélange jamais des questions de colonnes différentes ligne par ligne. Pour un document en arabe (texte de droite à gauche), l'ordre de lecture reste le même principe: suis l'ordre naturel de lecture de la langue du document, colonne par colonne, jamais ligne par ligne à travers plusieurs colonnes.",
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
        hint: z.string().max(5000).optional(),
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
        hint: z.string().max(5000).optional(),
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
        hint: z.string().max(5000).optional(),
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
        hint: z.string().max(5000).optional(),
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
        hint: z.string().max(5000).optional(),
        expected: z.number().int().min(0).max(200).optional(),
        detectCases: z.boolean().optional(),
        /** Leading pages included as context only — the questions to extract
         *  are on the LAST page. Lets a clinical-case vignette that started on
         *  the previous page still be visible to the model. */
        contextPages: z.number().int().min(0).max(4).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_quiz");
    const base64 = data.pdfDataUrl.replace(/^data:application\/pdf;base64,/i, "");
    return extractPdfChunkComplete(
      (chunkBase64, expected) => [
        {
          type: "text",
          text: INSTRUCTIONS(data.hint, data.detectCases ?? true, true, data.contextPages ?? 0),
        },
        { type: "text", text: expectedCountNote(expected) },
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
            `contient parfois un en-tête indiquant la rotation et/ou l'année.\n\n` +
            `Une ROTATION valide est TOUJOURS un code court de la forme "P" ou "R" ou ` +
            `"Pôle" suivi d'un chiffre 1 à 7 (ex: "P1", "P3", "R4", "Pôle 5"), ou une ` +
            `mention de session ("Rattrapage", "Session normale", "EMD") — presque ` +
            `toujours accompagnée d'une année à 4 chiffres (ex: "P3 2024").\n\n` +
            `Ne renvoie JAMAIS comme rotation : un nom d'institution, de ville ou de ` +
            `faculté (ex: "Externat Alger", "CHU Alger", "Faculté de médecine"), ni un ` +
            `titre de cours/leçon ou de document (ex: "Pneumologie - Tuberculose ` +
            `pulmonaire"), même si ce texte apparaît là où un en-tête serait attendu. ` +
            `Ce n'est jamais une rotation, quelle que soit sa position sur la page.\n\n` +
            `Exemple correct : en-tête "P3 2024" → rotation="P3", year="2024". ` +
            `Exemple à REJETER : en-tête "Externat Alger" → ce n'est pas une rotation, ` +
            `renvoie rotation=null (même si une année est visible par ailleurs).\n\n` +
            `Lis UNIQUEMENT un véritable en-tête rotation/année. Si aucun code de ` +
            `rotation valide n'est visible sur cette image, renvoie rotation à null — ` +
            `ne devine jamais et ne recopie jamais un autre texte à la place.`,
        },
        { type: "image", image: data.imageDataUrl },
      ],
      // Reading a small, often low-contrast header is exactly the kind of
      // careful visual task that benefits from thinking, same as extraction.
      { temperature: 0.1, timeoutMs: 60_000, thinking: true },
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
