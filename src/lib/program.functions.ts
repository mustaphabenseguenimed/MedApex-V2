import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateText, NoObjectGeneratedError, Output } from "ai";
import { z } from "zod";
import { getClaudeProvider, CLAUDE_DEFAULT_MODEL } from "./ai-provider.server";
import { assertAdminPermission } from "./admin-guard";

const LessonsSchema = z.object({ lessons: z.array(z.string().min(1).max(300)) });

const INSTRUCTIONS = [
  "Tu reçois le programme officiel d'un module de médecine (PDF, image, ou texte extrait d'un fichier Word).",
  "Extrais la liste ordonnée des cours / leçons / chapitres qui composent ce programme.",
  "Retourne uniquement les intitulés des cours, sans numérotation redondante, un par entrée.",
  "Ignore les titres génériques (Sommaire, Table des matières, Objectifs généraux, Bibliographie).",
  "Préserve l'ordre d'apparition. Ne rien inventer.",
].join("\n");

type Input =
  | { kind: "image"; dataUrl: string }
  | { kind: "pdf"; dataUrl: string; filename?: string }
  | { kind: "docx"; dataUrl: string }
  | { kind: "text"; text: string };

const InputSchema = z.union([
  z.object({
    kind: z.literal("image"),
    dataUrl: z
      .string()
      .max(15_000_000)
      .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,/i),
  }),
  z.object({
    kind: z.literal("pdf"),
    dataUrl: z
      .string()
      .max(25_000_000)
      .regex(/^data:application\/pdf;base64,/i),
    filename: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("docx"),
    dataUrl: z
      .string()
      .max(25_000_000)
      .regex(
        /^data:(application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document|application\/octet-stream);base64,/i,
      ),
  }),
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(200_000) }),
]);

export const extractLessonsFromProgram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InputSchema.parse(input) as Input)
  .handler(async ({ data, context }) => {
    await assertAdminPermission(context.supabase, context.userId, "manage_content");
    const anthropic = getClaudeProvider();
    if (!anthropic) throw new Error("ANTHROPIC_API_KEY manquante");
    const model = anthropic(CLAUDE_DEFAULT_MODEL);

    let content: any[];
    if (data.kind === "image") {
      content = [
        { type: "text", text: INSTRUCTIONS },
        { type: "image", image: data.dataUrl },
      ];
    } else if (data.kind === "pdf") {
      const base64 = data.dataUrl.replace(/^data:application\/pdf;base64,/i, "");
      content = [
        { type: "text", text: INSTRUCTIONS },
        {
          type: "file",
          data: base64,
          mediaType: "application/pdf",
          filename: data.filename ?? "program.pdf",
        },
      ];
    } else if (data.kind === "docx") {
      const base64 = data.dataUrl.replace(/^data:[^;]+;base64,/i, "");
      const buffer = Buffer.from(base64, "base64");
      const mammoth = await import("mammoth");
      let text = "";
      try {
        const result = await mammoth.extractRawText({ buffer });
        text = (result.value ?? "").trim();
      } catch (e: any) {
        throw new Error("Lecture du document Word impossible: " + (e?.message ?? "erreur"));
      }
      if (!text) return { lessons: [] as string[] };
      content = [
        { type: "text", text: INSTRUCTIONS },
        { type: "text", text: "Programme extrait du document Word:\n\n" + text.slice(0, 120_000) },
      ];
    } else {
      content = [
        { type: "text", text: INSTRUCTIONS },
        { type: "text", text: "Programme fourni:\n\n" + data.text.slice(0, 120_000) },
      ];
    }

    try {
      const { output } = await generateText({
        model,
        output: Output.object({ schema: LessonsSchema }),
        messages: [{ role: "user", content }],
      });
      // Deduplicate while preserving order
      const seen = new Set<string>();
      const lessons = output.lessons
        .map((l) => l.trim())
        .filter((l) => l.length > 0)
        .filter((l) => {
          const k = l.toLowerCase();
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      return { lessons };
    } catch (error) {
      if (NoObjectGeneratedError.isInstance(error)) return { lessons: [] as string[] };
      throw error;
    }
  });
