import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, ArrowLeft } from "lucide-react";
import { useTr } from "@/lib/i18n";

export type AccessScope = "lessons" | "sessions" | "both";

export const SCOPE_ORDER: AccessScope[] = ["lessons", "sessions", "both"];

export const SCOPE_LABEL: Record<AccessScope, string> = {
  lessons: "Cours seuls",
  sessions: "Sessions seules",
  both: "Les deux",
};

export const SCOPE_LABEL_EN: Record<AccessScope, string> = {
  lessons: "Lessons only",
  sessions: "Sessions only",
  both: "Both",
};

export function scopeLabel(scope: AccessScope, lang?: string): string {
  return lang === "en" ? SCOPE_LABEL_EN[scope] : SCOPE_LABEL[scope];
}

export type ScopeStatus = "loading" | "ok" | "locked";

/** Does the current user hold `scope` access for the module's year? */
export function useModuleScope(moduleId: string | undefined, scope: Exclude<AccessScope, "both">): ScopeStatus {
  const [status, setStatus] = useState<ScopeStatus>("loading");
  useEffect(() => {
    let cancel = false;
    (async () => {
      if (!moduleId) return;
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (!cancel) setStatus("locked"); return; }
      const { data } = await supabase.rpc("user_has_module_scope", {
        _user_id: u.user.id, _module_id: moduleId, _scope: scope,
      });
      if (!cancel) setStatus(data ? "ok" : "locked");
    })();
    return () => { cancel = true; };
  }, [moduleId, scope]);
  return status;
}

/** Does the current user hold `scope` access anywhere (any year or the pack)? */
export function useAnyScope(scope: Exclude<AccessScope, "both">): ScopeStatus {
  const [status, setStatus] = useState<ScopeStatus>("loading");
  useEffect(() => {
    let cancel = false;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (!cancel) setStatus("locked"); return; }
      const [{ data: role }, { data: ents }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle(),
        supabase.from("user_entitlements").select("scope, expires_at").eq("user_id", u.user.id),
      ]);
      if (cancel) return;
      if (role) { setStatus("ok"); return; }
      const now = Date.now();
      const ok = ((ents ?? []) as { scope: AccessScope; expires_at: string | null }[]).some(
        (e) => (e.scope === "both" || e.scope === scope) && (!e.expires_at || new Date(e.expires_at).getTime() > now),
      );
      setStatus(ok ? "ok" : "locked");
    })();
    return () => { cancel = true; };
  }, [scope]);
  return status;
}

export function ScopeLocked({ scope }: { scope: Exclude<AccessScope, "both"> }) {
  const tr = useTr();
  const message =
    scope === "lessons"
      ? tr("Votre formule ne comprend pas les cours. Ajoutez la formule « Cours » ou « Les deux » pour y accéder.")
      : tr("Votre formule ne comprend pas les sessions de questions. Ajoutez la formule « Sessions » ou « Les deux » pour y accéder.");
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Lock className="h-5 w-5" />{tr("Contenu verrouillé")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          <div className="flex gap-2">
            <Button asChild><Link to="/store">{tr("Voir la boutique")}</Link></Button>
            <Button asChild variant="ghost"><Link to="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Tableau de bord")}</Link></Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** Wraps a module page: renders children only when the scope is owned. */
export function ModuleScopeGate({ moduleId, scope, children }: {
  moduleId: string | undefined; scope: Exclude<AccessScope, "both">; children: ReactNode;
}) {
  const status = useModuleScope(moduleId, scope);
  if (status === "loading") return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (status === "locked") return <ScopeLocked scope={scope} />;
  return <>{children}</>;
}

/** Wraps a cross-module page (global questions/sessions). */
export function AnyScopeGate({ scope, children }: { scope: Exclude<AccessScope, "both">; children: ReactNode }) {
  const status = useAnyScope(scope);
  if (status === "loading") return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (status === "locked") return <ScopeLocked scope={scope} />;
  return <>{children}</>;
}