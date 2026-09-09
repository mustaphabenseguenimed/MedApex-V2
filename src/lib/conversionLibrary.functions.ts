import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdminPermission } from "./admin-guard";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const JSON_MIME = "application/json";

function extensionFor(outputKind: "docx" | "json"): string {
  return outputKind === "docx" ? "docx" : "json";
}
function mimeFor(outputKind: "docx" | "json"): string {
  return outputKind === "docx" ? DOCX_MIME : JSON_MIME;
}

/** Step 1-4: save a generated result to the shared conversion library, so
 *  any admin can find it later, re-download it, or continue from it without
 *  re-running the AI extraction. */
export const saveConversionLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        step: z.number().int().min(1).max(4),
        sourceFilenames: z.array(z.string()).min(1),
        label: z.string().trim().min(1).max(200),
        outputKind: z.enum(["docx", "json"]),
        // base64 for docx, raw JSON text for json — whatever the panel
        // already has in memory for its own download button.
        content: z.string().max(30_000_000),
        itemCount: z.number().int().nullable().optional(),
        moduleId: z.string().uuid().nullable().optional(),
        rotation: z.string().nullable().optional(),
        yearLabel: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");

    const bytes =
      data.outputKind === "docx"
        ? Buffer.from(data.content, "base64")
        : Buffer.from(data.content, "utf-8");
    const storagePath = `${data.step}/${crypto.randomUUID()}.${extensionFor(data.outputKind)}`;

    const { error: uploadError } = await supabase.storage
      .from("conversion-library")
      .upload(storagePath, bytes, { contentType: mimeFor(data.outputKind) });
    if (uploadError) throw uploadError;

    const { data: row, error } = await supabase
      .from("conversion_library_items")
      .insert({
        step: data.step,
        created_by: userId,
        source_filenames: data.sourceFilenames,
        label: data.label,
        output_kind: data.outputKind,
        storage_path: storagePath,
        item_count: data.itemCount ?? null,
        module_id: data.moduleId ?? null,
        rotation: data.rotation ?? null,
        year_label: data.yearLabel ?? null,
      })
      .select("id")
      .single();
    if (error) {
      // Best-effort cleanup so a failed insert doesn't leave an orphaned file.
      await supabase.storage.from("conversion-library").remove([storagePath]);
      throw error;
    }
    return { id: row.id };
  });

/** List past library entries for one step, newest first. */
export const listConversionLibraryItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ step: z.number().int().min(1).max(4) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");

    const { data: rows, error } = await supabase
      .from("conversion_library_items")
      .select(
        "id, step, created_at, source_filenames, label, output_kind, item_count, module_id, rotation, year_label",
      )
      .eq("step", data.step)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return { items: rows ?? [] };
  });

/** Rename a library entry's display label (its underlying file is untouched). */
export const renameConversionLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), label: z.string().trim().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");
    const { error } = await supabase
      .from("conversion_library_items")
      .update({ label: data.label })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/** Fetch a library entry's stored bytes back — for "Afficher" (preview),
 *  "Télécharger", or feeding it into the next step exactly like a fresh
 *  upload. */
export const getConversionLibraryItemContent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");

    const { data: row, error } = await supabase
      .from("conversion_library_items")
      .select("storage_path, output_kind, source_filenames, label")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error("Introuvable");

    const { data: file, error: downloadError } = await supabase.storage
      .from("conversion-library")
      .download(row.storage_path);
    if (downloadError || !file) throw new Error("Fichier introuvable");

    const buf = Buffer.from(await file.arrayBuffer());
    const content = row.output_kind === "docx" ? buf.toString("base64") : buf.toString("utf-8");
    return {
      content,
      outputKind: row.output_kind as "docx" | "json",
      sourceFilenames: row.source_filenames as string[],
      label: row.label as string,
    };
  });

/** Delete a library entry and its stored file. */
export const deleteConversionLibraryItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdminPermission(supabase, userId, "manage_quiz");

    const { data: row } = await supabase
      .from("conversion_library_items")
      .select("storage_path")
      .eq("id", data.id)
      .single();
    const { error } = await supabase.from("conversion_library_items").delete().eq("id", data.id);
    if (error) throw error;
    if (row?.storage_path) {
      await supabase.storage.from("conversion-library").remove([row.storage_path]);
    }
    return { ok: true };
  });
