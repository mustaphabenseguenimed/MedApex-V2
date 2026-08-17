import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function dirnameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
}
function basenameOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/**
 * Issue a short-lived signed token that grants access to a module_content's
 * file (and any sibling files in the same storage folder). Enforces module
 * access via RLS: the SELECT below returns null when the caller is not
 * entitled.
 */
export const issueModuleFileToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { contentId: string }) => {
    if (!data?.contentId || typeof data.contentId !== "string") {
      throw new Error("contentId required");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("module_contents")
      .select("id,file_path,kind")
      .eq("id", data.contentId)
      .maybeSingle();
    if (error) throw error;
    if (!row || !row.file_path) throw new Error("Not found");

    const { signModuleFileToken } = await import("./moduleFile.server");
    const prefix = dirnameOf(row.file_path);
    const entry = basenameOf(row.file_path);
    const token = await signModuleFileToken({
      cid: row.id,
      uid: userId,
      prefix,
      entry,
      exp: Math.floor(Date.now() / 1000) + 60 * 60, // 1h
    });
    return { token, entry };
  });