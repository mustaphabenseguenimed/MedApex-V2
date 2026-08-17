// Server-only helper: assert the caller holds a given admin permission.
// Uses the user's authenticated Supabase client so RLS + role checks apply.
import type { SupabaseClient } from "@supabase/supabase-js";

type Perm =
  | "manage_modules"
  | "manage_content"
  | "manage_quiz"
  | "manage_pricing"
  | "manage_access"
  | "manage_payments"
  | "manage_cases";

export async function assertAdminPermission(
  supabase: SupabaseClient<any>,
  userId: string,
  perm: Perm,
): Promise<void> {
  // Super admins bypass explicit permissions.
  const [{ data: isSuper }, { data: hasPerm }] = await Promise.all([
    supabase.rpc("is_super_admin", { _user_id: userId }),
    supabase.rpc("has_permission", { _user_id: userId, _perm: perm }),
  ]);
  if (isSuper === true || hasPerm === true) return;
  throw new Error("Forbidden: admin permission required");
}