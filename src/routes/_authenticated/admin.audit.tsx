import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ScrollText, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/audit")({
  head: () => ({ meta: [{ title: "Journal d'audit — Admin" }] }),
  component: AuditPage,
});

type Row = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: any;
  created_at: string;
};

function AuditPage() {
  const { tr } = useI18n();
  const { loading, isSuper } = useAdminPermissions();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase
      .from("admin_audit_log")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setRows((data as Row[]) ?? []);
  };

  useEffect(() => { if (!loading && isSuper) load(); }, [loading, isSuper]);

  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>{tr("Réservé au super admin")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{tr("Seul le super administrateur peut consulter le journal d'audit.")}</p>
            <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Retour")}</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const filtered = rows.filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (r.actor_email ?? "").toLowerCase().includes(s) ||
      r.action.toLowerCase().includes(s) ||
      (r.target_type ?? "").toLowerCase().includes(s) ||
      (r.target_id ?? "").toLowerCase().includes(s)
    );
  });

  const actionVariant = (a: string): "default" | "secondary" | "destructive" | "outline" => {
    if (a.startsWith("DELETE") || a.includes("reject") || a.includes("revoke")) return "destructive";
    if (a.startsWith("INSERT") || a.includes("approve") || a.includes("promote")) return "default";
    if (a.startsWith("UPDATE")) return "secondary";
    return "outline";
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />Admin</Link></Button>
        <h1 className="text-lg font-semibold flex items-center gap-2"><ScrollText className="h-5 w-5" />{tr("Journal d'audit")}</h1>
        <Button variant="outline" size="sm" onClick={load} disabled={busy}><RefreshCw className="mr-1.5 h-4 w-4" />{tr("Actualiser")}</Button>
      </div></header>
      <main className="mx-auto max-w-6xl px-6 py-8 space-y-4">
        <div className="flex items-center gap-2">
          <Input placeholder={tr("Filtrer (email, action, cible…)")} value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} / {rows.length}</span>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">{tr("500 dernières actions")}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {filtered.length === 0 && <p className="text-sm text-muted-foreground">{tr("Aucune entrée.")}</p>}
            {filtered.map((r) => {
              const isOpen = expanded === r.id;
              return (
                <div key={r.id} className="rounded-md border">
                  <button
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Badge variant={actionVariant(r.action)} className="shrink-0">{r.action}</Badge>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {new Date(r.created_at).toLocaleString("fr-FR")}
                      </span>
                      <span className="truncate">{r.actor_email ?? r.actor_id ?? tr("système")}</span>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                      {r.target_type}{r.target_id ? ` · ${r.target_id.slice(0, 8)}` : ""}
                    </div>
                  </button>
                  {isOpen && (
                    <div className="border-t bg-muted/30 p-3 text-xs">
                      <div className="grid gap-1 sm:grid-cols-2 mb-2">
                        <div><span className="text-muted-foreground">{tr("Acteur ID:")}</span> <code>{r.actor_id ?? "—"}</code></div>
                        <div><span className="text-muted-foreground">{tr("Cible:")}</span> <code>{r.target_type ?? "—"} / {r.target_id ?? "—"}</code></div>
                      </div>
                      <pre className="overflow-auto max-h-80 rounded bg-background p-2 text-[11px]">
{JSON.stringify(r.details, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}