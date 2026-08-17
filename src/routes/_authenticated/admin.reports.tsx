import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Check, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: ReportsPage,
});

type Report = {
  id: string;
  question_id: string;
  user_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  questions: { stem: string; module_id: string } | null;
};

function ReportsPage() {
  const { tr } = useI18n();
  const { loading, isSuper, has } = useAdminPermissions();
  const canManage = isSuper || has("manage_quiz");
  const [rows, setRows] = useState<Report[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");

  const load = async () => {
    let q = supabase
      .from("question_reports")
      .select("id, question_id, user_id, reason, details, status, created_at, questions(stem, module_id)")
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setRows((data as unknown as Report[]) ?? []);
  };
  useEffect(() => { if (canManage) load(); /* eslint-disable-next-line */ }, [canManage, filter]);

  if (loading) return null;
  if (!canManage) return <Navigate to="/admin" />;

  const setStatus = async (id: string, status: "resolved" | "rejected") => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("question_reports").update({
      status, resolved_by: u.user?.id ?? null, resolved_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) toast.error(error.message); else { toast.success(tr("Mis à jour")); load(); }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-4xl px-6 py-4">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Admin")}</Link></Button>
      </div></header>
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold tracking-tight">{tr("Signalements de questions")}</h1>
          <div className="flex gap-1">
            {(["open", "resolved", "all"] as const).map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "default" : "outline"} onClick={() => setFilter(f)}>
                {f === "open" ? tr("Ouverts") : f === "resolved" ? tr("Résolus") : tr("Tous")}
              </Button>
            ))}
          </div>
        </div>
        <Card><CardHeader><CardTitle className="text-base">{rows.length} {rows.length > 1 ? tr("signalements") : tr("signalement")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && <p className="text-sm text-muted-foreground">{tr("Rien à afficher.")}</p>}
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <Badge variant="outline">{r.reason}</Badge>
                  <Badge variant={r.status === "open" ? "destructive" : "secondary"}>{r.status}</Badge>
                  <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div className="text-sm font-medium whitespace-pre-wrap">{r.questions?.stem ?? tr("(question introuvable)")}</div>
                {r.details && <div className="text-sm text-muted-foreground whitespace-pre-wrap">{r.details}</div>}
                {r.status === "open" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" onClick={() => setStatus(r.id, "resolved")}><Check className="h-4 w-4 mr-1" />{tr("Marquer résolu")}</Button>
                    <Button size="sm" variant="outline" onClick={() => setStatus(r.id, "rejected")}><X className="h-4 w-4 mr-1" />{tr("Rejeter")}</Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}