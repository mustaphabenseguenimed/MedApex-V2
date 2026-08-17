import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AdminPermission =
  | "manage_modules"
  | "manage_content"
  | "manage_quiz"
  | "manage_pricing"
  | "manage_access"
  | "manage_payments"
  | "manage_cases";

export function useAdminPermissions() {
  const [loading, setLoading] = useState(true);
  const [isSuper, setIsSuper] = useState(false);
  const [perms, setPerms] = useState<AdminPermission[]>([]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (!cancel) { setLoading(false); } return; }
      const [{ data: role }, { data: p }] = await Promise.all([
        supabase.from("user_roles").select("is_super").eq("user_id", u.user.id).eq("role", "admin").maybeSingle(),
        supabase.from("admin_permissions").select("permission").eq("user_id", u.user.id),
      ]);
      if (cancel) return;
      setIsSuper(!!(role as any)?.is_super);
      setPerms(((p ?? []) as any[]).map((r) => r.permission as AdminPermission));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, []);

  const has = (perm: AdminPermission) => isSuper || perms.includes(perm);
  return { loading, isSuper, perms, has };
}