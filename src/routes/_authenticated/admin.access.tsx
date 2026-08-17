import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Plus, Trash2, Search, CalendarClock, Infinity as InfinityIcon, RefreshCw, Mail } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { deadlineFor, isExpired, YEAR_DEADLINE, BUNDLE_DEADLINE } from "@/lib/deadlines";
import { SCOPE_ORDER, scopeLabel, type AccessScope } from "@/lib/scopes";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/access")({
  head: () => ({ meta: [{ title: "Accès utilisateurs — Admin" }] }),
  component: AccessAdmin,
});

type UserRow = { user_id: string; email: string | null; display_name: string | null; created_at: string };
type Ent = { id: string; user_id: string; year: number | null; is_bundle: boolean; scope: AccessScope; created_at: string; expires_at: string | null };

function toLocalInput(d: Date | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AccessAdmin() {
  const { loading, isSuper } = useAdminPermissions();
  const { tr } = useI18n();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [ents, setEnts] = useState<Ent[]>([]);
  const [allEnts, setAllEnts] = useState<Ent[]>([]);
  const [grantKind, setGrantKind] = useState<"year" | "bundle">("year");
  const [grantYear, setGrantYear] = useState("1");
  const [grantScope, setGrantScope] = useState<AccessScope>("both");
  const [editing, setEditing] = useState<Ent | null>(null);
  const [busy, setBusy] = useState(false);

  const loadUsers = async () => {
    const { data, error } = await supabase.rpc("list_all_users");
    if (error) { toast.error(error.message); return; }
    setUsers((data as UserRow[]) ?? []);
  };
  const loadAllEnts = async () => {
    const { data } = await supabase.from("user_entitlements").select("id, user_id, year, is_bundle, scope, created_at, expires_at");
    setAllEnts((data as Ent[]) ?? []);
  };
  useEffect(() => { loadUsers(); loadAllEnts(); }, []);

  const loadEnts = async (uid: string) => {
    const { data } = await supabase.from("user_entitlements").select("*").eq("user_id", uid).order("created_at", { ascending: false });
    setEnts((data as Ent[]) ?? []);
    loadAllEnts();
  };
  useEffect(() => { if (selected) loadEnts(selected.user_id); else setEnts([]); }, [selected]);

  const countByUser = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of allEnts) m[e.user_id] = (m[e.user_id] ?? 0) + 1;
    return m;
  }, [allEnts]);

  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper) return <div className="p-10 text-center text-muted-foreground">{tr("Réservé au super administrateur.")}</div>;

  const grant = async () => {
    if (!selected) return;
    const isBundle = grantKind === "bundle";
    const payload = {
      user_id: selected.user_id,
      year: isBundle ? null : Number(grantYear),
      is_bundle: isBundle,
      scope: grantScope,
      expires_at: deadlineFor(isBundle).toISOString(),
    };
    const { error } = await supabase.from("user_entitlements").insert(payload);
    if (error) toast.error(error.message); else { toast.success(tr("Accès accordé")); loadEnts(selected.user_id); }
  };

  const revoke = async (id: string) => {
    if (!confirm(tr("Retirer cet accès ?"))) return;
    const { error } = await supabase.from("user_entitlements").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success(tr("Retiré")); selected && loadEnts(selected.user_id); }
  };

  const needle = q.toLowerCase();
  const filtered = users.filter((u) => !q
    || (u.display_name ?? "").toLowerCase().includes(needle)
    || (u.email ?? "").toLowerCase().includes(needle)
    || u.user_id.includes(q));

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Admin")}</Link></Button>
        <h1 className="text-lg font-semibold">{tr("Accès & abonnements")}</h1>
        <Button variant="outline" size="sm" onClick={() => { loadUsers(); loadAllEnts(); selected && loadEnts(selected.user_id); }}>
          <RefreshCw className="mr-1.5 h-4 w-4" />{tr("Actualiser")}
        </Button>
      </div></header>
      <main className="mx-auto max-w-6xl px-6 py-8 grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card>
          <CardHeader><CardTitle className="text-base">{tr("Utilisateurs")} ({users.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <div className="relative"><Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Nom, e-mail, id…")} className="pl-8" />
            </div>
            <div className="max-h-[60vh] overflow-y-auto space-y-1">
              {filtered.map((u) => (
                <button key={u.user_id} onClick={() => setSelected(u)}
                  className={`w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${selected?.user_id === u.user_id ? "border-primary bg-accent" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{u.display_name ?? tr("(sans nom)")}</span>
                    {(countByUser[u.user_id] ?? 0) > 0 && <Badge variant="secondary">{countByUser[u.user_id]}</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
                    <Mail className="h-3 w-3 shrink-0" />{u.email ?? "—"}
                  </div>
                </button>
              ))}
              {filtered.length === 0 && <p className="text-sm text-muted-foreground px-1 py-2">{tr("Aucun utilisateur.")}</p>}
            </div>
          </CardContent>
        </Card>

        <section>
          {selected ? (
            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{tr("Accorder un abonnement à")} {selected.display_name ?? selected.email ?? selected.user_id.slice(0, 8)}</CardTitle>
                  <p className="text-xs text-muted-foreground">{selected.email ?? "—"} · <span className="font-mono">{selected.user_id}</span></p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="space-y-1"><Label>{tr("Type")}</Label>
                      <Select value={grantKind} onValueChange={(v) => setGrantKind(v as any)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="year">{tr("Une année")}</SelectItem>
                          <SelectItem value="bundle">{tr("Pack complet")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {grantKind === "year" && (
                      <div className="space-y-1"><Label>{tr("Année")}</Label>
                        <Select value={grantYear} onValueChange={setGrantYear}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{[1,2,3,4,5,6].map((y) => <SelectItem key={y} value={String(y)}>{tr("Année")} {y}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1"><Label>{tr("Formule")}</Label>
                      <Select value={grantScope} onValueChange={(v) => setGrantScope(v as AccessScope)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {SCOPE_ORDER.map((s) => <SelectItem key={s} value={s}>{scopeLabel(s)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end"><Button onClick={grant}><Plus className="mr-1.5 h-4 w-4" />{tr("Accorder")}</Button></div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base">{tr("Abonnements actuels")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {ents.length === 0 && <p className="text-sm text-muted-foreground">{tr("Aucun abonnement.")}</p>}
                  {ents.map((e) => (
                    <div key={e.id} className="flex items-center justify-between gap-2 flex-wrap rounded-md border px-3 py-2 text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        {e.is_bundle ? <Badge>{tr("Pack complet")}</Badge> : <Badge variant="secondary">{tr("Année")} {e.year}</Badge>}
                        <Badge variant="outline">{scopeLabel(e.scope)}</Badge>
                        <span className="text-xs text-muted-foreground">{new Date(e.created_at).toLocaleDateString("fr-FR")}</span>
                        {e.expires_at == null ? (
                          <Badge variant="outline"><InfinityIcon className="h-3 w-3 mr-1" />{tr("Sans expiration")}</Badge>
                        ) : (
                          <span className={`text-xs ${isExpired(e.expires_at) ? "text-destructive" : "text-muted-foreground"}`}>
                            {isExpired(e.expires_at) ? tr("Expiré le ") : tr("Expire le ")}
                            {new Date(e.expires_at).toLocaleDateString("fr-FR")}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={() => setEditing(e)}>
                          <CalendarClock className="mr-1.5 h-4 w-4" />{tr("Expiration")}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke(e.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card><CardContent className="py-16 text-center text-muted-foreground">{tr("Sélectionnez un utilisateur.")}</CardContent></Card>
          )}
        </section>
      </main>

      <EditExpiryDialog
        row={editing}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (val) => {
          if (!editing) return;
          setBusy(true);
          const { error } = await supabase.from("user_entitlements").update({ expires_at: val }).eq("id", editing.id);
          setBusy(false);
          if (error) { toast.error(error.message); return; }
          toast.success(tr("Expiration mise à jour"));
          setEditing(null);
          selected && loadEnts(selected.user_id);
        }}
      />
    </div>
  );
}

function EditExpiryDialog({ row, onClose, onSave, busy }: {
  row: Ent | null; onClose: () => void; onSave: (val: string | null) => void; busy: boolean;
}) {
  const { tr } = useI18n();
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<"date" | "lifetime">("date");

  useEffect(() => {
    if (!row) return;
    if (row.expires_at) { setMode("date"); setValue(toLocalInput(new Date(row.expires_at))); }
    else { setMode("lifetime"); setValue(toLocalInput(deadlineFor(row.is_bundle))); }
  }, [row]);

  if (!row) return null;
  const defaultDeadline = row.is_bundle ? BUNDLE_DEADLINE : YEAR_DEADLINE;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{tr("Modifier l'expiration")}</DialogTitle>
          <DialogDescription>
            {row.is_bundle ? tr("Pack complet") : `${tr("Année")} ${row.year}`} — {scopeLabel(row.scope)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === "date" ? "default" : "outline"} onClick={() => setMode("date")}>{tr("Date fixe")}</Button>
            <Button size="sm" variant={mode === "lifetime" ? "default" : "outline"} onClick={() => setMode("lifetime")}>{tr("Sans expiration")}</Button>
          </div>

          {mode === "date" ? (
            <div className="space-y-2">
              <Label>{tr("Date d'expiration")}</Label>
              <Input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="ghost" onClick={() => setValue(toLocalInput(defaultDeadline))}>
                  {tr("Défaut")} ({defaultDeadline.toLocaleDateString("fr-FR")})
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); d.setMonth(d.getMonth() + 1); setValue(toLocalInput(d)); }}>{tr("+1 mois")}</Button>
                <Button size="sm" variant="ghost" onClick={() => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); setValue(toLocalInput(d)); }}>{tr("+1 an")}</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{tr("Cet abonnement n'expirera jamais.")}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{tr("Annuler")}</Button>
          <Button disabled={busy || (mode === "date" && !value)} onClick={() => onSave(mode === "lifetime" ? null : new Date(value).toISOString())}>
            {busy ? tr("Enregistrement…") : tr("Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}