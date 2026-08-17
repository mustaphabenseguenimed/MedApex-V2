import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, Trash2, UserPlus, Plus, X } from "lucide-react";
import { useAdminPermissions, type AdminPermission } from "@/hooks/use-permissions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/admins")({
  head: () => ({ meta: [{ title: "Admins — Portail de Révision" }] }),
  component: AdminsPage,
});

const ALL_PERMS: { key: AdminPermission; label: string; hint: string }[] = [
  { key: "manage_modules", label: "Modules", hint: "Créer / éditer / supprimer des modules" },
  { key: "manage_content", label: "Résumés & PDF", hint: "Ajouter HTML, PDF et notes" },
  { key: "manage_quiz", label: "QCM", hint: "Ajouter / éditer les QCM" },
  { key: "manage_cases", label: "Cas cliniques", hint: "Créer / éditer les cas cliniques" },
  { key: "manage_pricing", label: "Tarifs", hint: "Modifier les prix par année et le bundle" },
  { key: "manage_access", label: "Accès", hint: "Accorder / retirer manuellement les accès" },
  { key: "manage_payments", label: "Paiements", hint: "Valider / rejeter les demandes de paiement" },
];

function PermissionsPicker({ value, onChange }: { value: AdminPermission[]; onChange: (v: AdminPermission[]) => void }) {
  const { tr } = useI18n();
  const available = ALL_PERMS.filter((p) => !value.includes(p.key));
  const remove = (k: AdminPermission) => onChange(value.filter((x) => x !== k));
  const add = (k: string) => { if (!k) return; onChange([...value, k as AdminPermission]); };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5 min-h-[32px]">
        {value.length === 0 && <span className="text-xs text-muted-foreground">{tr("Aucune permission")}</span>}
        {value.map((k) => {
          const p = ALL_PERMS.find((x) => x.key === k);
          return (
            <Badge key={k} variant="secondary" className="gap-1 pr-1">
              {p ? tr(p.label) : k}
              <button type="button" onClick={() => remove(k)} className="ml-0.5 rounded hover:bg-background/60 p-0.5" title={tr("Retirer")}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}
      </div>
      {available.length > 0 && (
        <div className="flex items-center gap-2">
          <Select onValueChange={(v) => add(v)} value="">
            <SelectTrigger className="h-8 w-64"><SelectValue placeholder={tr("Ajouter une permission…")} /></SelectTrigger>
            <SelectContent>
              {available.map((p) => (
                <SelectItem key={p.key} value={p.key}>
                  <span className="font-medium">{tr(p.label)}</span> <span className="text-xs text-muted-foreground">— {tr(p.hint)}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Plus className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
      )}
    </div>
  );
}

type AdminRow = { user_id: string; email: string | null; is_super: boolean; permissions: string[] };

function AdminsPage() {
  const { loading, isSuper } = useAdminPermissions();
  const { tr } = useI18n();
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc("list_admins");
    if (error) { toast.error(error.message); return; }
    setRows(((data ?? []) as any[]).map((r) => ({
      user_id: r.user_id, email: r.email, is_super: r.is_super,
      permissions: (r.permissions ?? []) as string[],
    })));
  };

  useEffect(() => { if (!loading && isSuper) load(); }, [loading, isSuper]);

  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader><CardTitle>{tr("Réservé au super admin")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{tr("Seul le super administrateur peut promouvoir d'autres admins.")}</p>
            <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Retour")}</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Admin")}</Link></Button>
        <h1 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" />{tr("Administrateurs")}</h1>
        <div className="w-16" />
      </div></header>
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        <PromoteForm busy={busy} setBusy={setBusy} onDone={load} />

        <Card>
          <CardHeader><CardTitle className="text-base">{tr("Admins existants")}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && <p className="text-sm text-muted-foreground">{tr("Aucun admin.")}</p>}
            {rows.map((r) => (
              <AdminRowEditor key={r.user_id} row={r} onChanged={load} />
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function PromoteForm({ busy, setBusy, onDone }: { busy: boolean; setBusy: (b: boolean) => void; onDone: () => void }) {
  const { tr } = useI18n();
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<AdminPermission[]>([]);
  const toggle = (p: AdminPermission) =>
    setSelected((s) => s.includes(p) ? s.filter((x) => x !== p) : [...s, p]);

  const submit = async () => {
    if (!email.trim()) { toast.error(tr("Email requis")); return; }
    setBusy(true);
    const { error } = await supabase.rpc("promote_admin", { _email: email.trim(), _perms: selected });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`${email} ${tr("est maintenant admin")}`);
    setEmail(""); setSelected([]);
    onDone();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base flex items-center gap-2"><UserPlus className="h-4 w-4" />Promouvoir un utilisateur</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Email de l'utilisateur (déjà inscrit)</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ex: collab@exemple.com" />
        </div>
        <div className="space-y-2">
          <Label>Permissions accordées</Label>
          <PermissionsPicker value={selected} onChange={setSelected} />
          <p className="text-xs text-muted-foreground">Utilisez le sélecteur pour ajouter, cliquez sur × pour retirer.</p>
        </div>
        <Button onClick={submit} disabled={busy}>{busy ? "…" : "Promouvoir"}</Button>
      </CardContent>
    </Card>
  );
}

function AdminRowEditor({ row, onChanged }: { row: AdminRow; onChanged: () => void }) {
  const { tr } = useI18n();
  const [selected, setSelected] = useState<AdminPermission[]>(row.permissions as AdminPermission[]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setSelected(row.permissions as AdminPermission[]); }, [row.user_id, row.permissions.join(",")]);

  const save = async () => {
    if (!row.email) { toast.error(tr("Email inconnu")); return; }
    setBusy(true);
    const { error } = await supabase.rpc("promote_admin", { _email: row.email, _perms: selected });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(tr("Permissions mises à jour")); onChanged(); }
  };

  const revoke = async () => {
    if (!confirm(`${tr("Retirer les droits admin de")} ${row.email} ?`)) return;
    setBusy(true);
    const { error } = await supabase.rpc("revoke_admin", { _user_id: row.user_id });
    setBusy(false);
    if (error) toast.error(error.message); else { toast.success(tr("Admin révoqué")); onChanged(); }
  };

  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium truncate">{row.email ?? row.user_id}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            {row.is_super && <Badge>{tr("Super admin")}</Badge>}
            {!row.is_super && <span>{tr("Admin")}</span>}
          </div>
        </div>
        {!row.is_super && (
          <Button variant="ghost" size="sm" className="text-destructive" onClick={revoke} disabled={busy}>
            <Trash2 className="mr-1.5 h-4 w-4" />{tr("Révoquer")}
          </Button>
        )}
      </div>

      {row.is_super ? (
        <p className="text-xs text-muted-foreground">{tr("Accès total. Les permissions ne s'appliquent pas.")}</p>
      ) : (
        <>
          <PermissionsPicker value={selected} onChange={setSelected} />
          <Button size="sm" onClick={save} disabled={busy}>{tr("Enregistrer")}</Button>
        </>
      )}
    </div>
  );
}