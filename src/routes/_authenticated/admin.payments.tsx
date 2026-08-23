import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Trash2, Plus, Check, X, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useConfirm } from "@/hooks/use-confirm";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/payments")({
  head: () => ({ meta: [{ title: "Paiements — Admin" }] }),
  component: PaymentsAdmin,
});

type Method = {
  id: string;
  kind: string;
  label: string;
  account_holder: string;
  account_number: string;
  extra: string | null;
  instructions: string | null;
  is_active: boolean;
  sort_order: number;
};
type Req = {
  id: string;
  user_id: string;
  is_bundle: boolean;
  year: number | null;
  scope: "lessons" | "sessions" | "both";
  amount_dzd: number;
  method_kind: string;
  transaction_ref: string | null;
  proof_path: string | null;
  note: string | null;
  status: string;
  created_at: string;
  reject_reason: string | null;
};
type Profile = { id: string; display_name: string | null };
type UserInfo = { display_name: string | null; email: string | null };

async function loadUserInfos(ids: string[]): Promise<Record<string, UserInfo>> {
  const map: Record<string, UserInfo> = {};
  if (!ids.length) return map;
  const { data: profs } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  (profs as Profile[] | null)?.forEach((p) => {
    map[p.id] = { display_name: p.display_name, email: null };
  });
  const { data: users } = await supabase.rpc("list_all_users");
  (users as any[] | null)?.forEach((u) => {
    if (!ids.includes(u.user_id)) return;
    map[u.user_id] = {
      display_name: u.display_name ?? map[u.user_id]?.display_name ?? null,
      email: u.email ?? null,
    };
  });
  return map;
}

function UserLine({ info, userId }: { info?: UserInfo; userId: string }) {
  return (
    <div className="flex flex-col">
      <span>{info?.display_name || userId.slice(0, 8)}</span>
      {info?.email && (
        <span className="text-xs font-normal text-muted-foreground">{info.email}</span>
      )}
    </div>
  );
}

function PaymentsAdmin() {
  const { loading, isSuper, has } = useAdminPermissions();
  const { tr } = useI18n();
  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper && !has("manage_payments"))
    return (
      <div className="p-10 text-center text-muted-foreground">
        {tr("Permission requise : gestion des paiements.")}
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Admin")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{tr("Paiements")}</h1>
          <div />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Tabs defaultValue="requests">
          <TabsList>
            <TabsTrigger value="requests">{tr("Demandes")}</TabsTrigger>
            <TabsTrigger value="history">{tr("Historique")}</TabsTrigger>
            <TabsTrigger value="methods">{tr("Méthodes de paiement")}</TabsTrigger>
          </TabsList>
          <TabsContent value="requests" className="mt-6">
            <RequestsPanel />
          </TabsContent>
          <TabsContent value="history" className="mt-6">
            <HistoryPanel />
          </TabsContent>
          <TabsContent value="methods" className="mt-6">
            <MethodsPanel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function RequestsPanel() {
  const { tr, lang } = useI18n();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserInfo>>({});
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");

  const load = async () => {
    let q = supabase.from("payment_requests").select("*").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    const rows = (data as Req[]) ?? [];
    setReqs(rows);
    const ids = Array.from(new Set(rows.map((r) => r.user_id)));
    setProfiles(await loadUserInfos(ids));
  };
  useEffect(() => {
    load();
  }, [filter]);

  const openProof = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(path, 300);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const approve = async (id: string) => {
    const { error } = await supabase.rpc("approve_payment_request", { _request_id: id });
    if (error) toast.error(error.message);
    else {
      toast.success(tr("Demande approuvée"));
      load();
    }
  };
  const reject = async (id: string) => {
    const reason = window.prompt(tr("Motif du rejet ?")) ?? "";
    if (!reason.trim()) return;
    const { error } = await supabase.rpc("reject_payment_request", {
      _request_id: id,
      _reason: reason,
    });
    if (error) toast.error(error.message);
    else {
      toast.success(tr("Demande rejetée"));
      load();
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">
          {tr("Demandes")} ({reqs.length})
        </CardTitle>
        <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">{tr("En attente")}</SelectItem>
            <SelectItem value="approved">{tr("Approuvées")}</SelectItem>
            <SelectItem value="rejected">{tr("Rejetées")}</SelectItem>
            <SelectItem value="all">{tr("Toutes")}</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>
      <CardContent className="space-y-3">
        {reqs.length === 0 && (
          <p className="text-sm text-muted-foreground">{tr("Aucune demande.")}</p>
        )}
        {reqs.map((r) => (
          <div key={r.id} className="rounded-lg border p-4 space-y-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <div className="font-medium space-y-0.5">
                  <UserLine info={profiles[r.user_id]} userId={r.user_id} />
                  <div>
                    {r.is_bundle ? tr("Pack complet") : `${tr("Année")} ${r.year}`} ·{" "}
                    {r.scope === "lessons"
                      ? tr("Cours seuls")
                      : r.scope === "sessions"
                        ? tr("Sessions seules")
                        : tr("Les deux")}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Intl.NumberFormat("fr-FR").format(r.amount_dzd)} DZD · {r.method_kind} ·{" "}
                  {new Date(r.created_at).toLocaleString("fr-FR")}
                </div>
              </div>
              {r.status === "pending" && <Badge variant="outline">{tr("En attente")}</Badge>}
              {r.status === "approved" && (
                <Badge className="bg-emerald-600 hover:bg-emerald-600">{tr("Approuvée")}</Badge>
              )}
              {r.status === "rejected" && <Badge variant="destructive">{tr("Rejetée")}</Badge>}
            </div>
            {r.transaction_ref && (
              <div className="text-sm">
                {tr("Référence")} :{" "}
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{r.transaction_ref}</code>
              </div>
            )}
            {r.note && (
              <div className="text-sm text-muted-foreground">
                {tr("Note")} : {r.note}
              </div>
            )}
            {r.reject_reason && (
              <div className="text-sm text-destructive">
                {tr("Motif")} : {r.reject_reason}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {r.proof_path && (
                <Button size="sm" variant="outline" onClick={() => openProof(r.proof_path!)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {tr("Voir la preuve")}
                </Button>
              )}
              {r.status === "pending" && (
                <>
                  <Button size="sm" onClick={() => approve(r.id)}>
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Approuver")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => reject(r.id)}>
                    <X className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Rejeter")}
                  </Button>
                </>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function MethodsPanel() {
  const { tr } = useI18n();
  const confirm = useConfirm();
  const [methods, setMethods] = useState<Method[]>([]);
  const empty: Omit<Method, "id"> = {
    kind: "baridimob",
    label: "",
    account_holder: "",
    account_number: "",
    extra: "",
    instructions: "",
    is_active: true,
    sort_order: 0,
  };
  const [creating, setCreating] = useState<Omit<Method, "id">>(empty);

  const load = async () => {
    const { data } = await supabase.from("payment_methods").select("*").order("sort_order");
    setMethods((data as Method[]) ?? []);
  };
  useEffect(() => {
    load();
  }, []);

  const save = async (m: Method) => {
    const { error } = await supabase
      .from("payment_methods")
      .update({
        kind: m.kind,
        label: m.label,
        account_holder: m.account_holder,
        account_number: m.account_number,
        extra: m.extra,
        instructions: m.instructions,
        is_active: m.is_active,
        sort_order: m.sort_order,
      })
      .eq("id", m.id);
    if (error) toast.error(error.message);
    else toast.success(tr("Enregistré"));
  };
  const remove = async (id: string) => {
    if (!(await confirm(tr("Supprimer cette méthode ?"), { variant: "destructive" }))) return;
    const { error } = await supabase.from("payment_methods").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(tr("Supprimé"));
      load();
    }
  };
  const create = async () => {
    if (!creating.label || !creating.account_number) {
      toast.error(tr("Libellé et numéro requis"));
      return;
    }
    const { error } = await supabase.from("payment_methods").insert(creating);
    if (error) toast.error(error.message);
    else {
      toast.success(tr("Créé"));
      setCreating(empty);
      load();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Plus className="h-4 w-4" />
            {tr("Nouvelle méthode")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>{tr("Type")}</Label>
              <Select
                value={creating.kind}
                onValueChange={(v) => setCreating({ ...creating, kind: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="baridimob">{tr("BaridiMob (Edahabia)")}</SelectItem>
                  <SelectItem value="ccp">CCP</SelectItem>
                  <SelectItem value="rib">{tr("RIB bancaire")}</SelectItem>
                  <SelectItem value="other">{tr("Autre")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{tr("Libellé")}</Label>
              <Input
                value={creating.label}
                onChange={(e) => setCreating({ ...creating, label: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr("Bénéficiaire")}</Label>
              <Input
                value={creating.account_holder}
                onChange={(e) => setCreating({ ...creating, account_holder: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>{tr("N° de compte")}</Label>
              <Input
                value={creating.account_number}
                onChange={(e) => setCreating({ ...creating, account_number: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{tr("Info supplémentaire")}</Label>
            <Input
              value={creating.extra ?? ""}
              onChange={(e) => setCreating({ ...creating, extra: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label>{tr("Instructions")}</Label>
            <Textarea
              rows={2}
              value={creating.instructions ?? ""}
              onChange={(e) => setCreating({ ...creating, instructions: e.target.value })}
            />
          </div>
          <Button onClick={create}>
            <Plus className="mr-1.5 h-4 w-4" />
            {tr("Créer")}
          </Button>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {methods.map((m, idx) => (
          <Card key={m.id}>
            <CardContent className="pt-6 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{tr("Type")}</Label>
                  <Select
                    value={m.kind}
                    onValueChange={(v) => {
                      const c = [...methods];
                      c[idx] = { ...m, kind: v };
                      setMethods(c);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="baridimob">{tr("BaridiMob (Edahabia)")}</SelectItem>
                      <SelectItem value="ccp">CCP</SelectItem>
                      <SelectItem value="rib">{tr("RIB bancaire")}</SelectItem>
                      <SelectItem value="other">{tr("Autre")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{tr("Libellé")}</Label>
                  <Input
                    value={m.label}
                    onChange={(e) => {
                      const c = [...methods];
                      c[idx] = { ...m, label: e.target.value };
                      setMethods(c);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("Bénéficiaire")}</Label>
                  <Input
                    value={m.account_holder}
                    onChange={(e) => {
                      const c = [...methods];
                      c[idx] = { ...m, account_holder: e.target.value };
                      setMethods(c);
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{tr("N° de compte")}</Label>
                  <Input
                    value={m.account_number}
                    onChange={(e) => {
                      const c = [...methods];
                      c[idx] = { ...m, account_number: e.target.value };
                      setMethods(c);
                    }}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{tr("Info supplémentaire")}</Label>
                <Input
                  value={m.extra ?? ""}
                  onChange={(e) => {
                    const c = [...methods];
                    c[idx] = { ...m, extra: e.target.value };
                    setMethods(c);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>{tr("Instructions")}</Label>
                <Textarea
                  rows={2}
                  value={m.instructions ?? ""}
                  onChange={(e) => {
                    const c = [...methods];
                    c[idx] = { ...m, instructions: e.target.value };
                    setMethods(c);
                  }}
                />
              </div>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={m.is_active}
                      onCheckedChange={(v) => {
                        const c = [...methods];
                        c[idx] = { ...m, is_active: v };
                        setMethods(c);
                      }}
                    />
                    <span className="text-sm text-muted-foreground">
                      {m.is_active ? tr("Actif") : tr("Inactif")}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <Label>{tr("Ordre")}</Label>
                    <Input
                      type="number"
                      className="w-20"
                      value={m.sort_order}
                      onChange={(e) => {
                        const c = [...methods];
                        c[idx] = { ...m, sort_order: Number(e.target.value) || 0 };
                        setMethods(c);
                      }}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => save(m)}>
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Enregistrer")}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(m.id)}>
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Supprimer")}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function HistoryPanel() {
  const { tr } = useI18n();
  const { isSuper } = useAdminPermissions();
  const [reqs, setReqs] = useState<Req[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserInfo>>({});
  const [filter, setFilter] = useState<"all" | "approved" | "rejected">("all");
  const [q, setQ] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});

  const load = async () => {
    let query = supabase
      .from("payment_requests")
      .select("*")
      .in("status", ["approved", "rejected"])
      .order("reviewed_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (filter !== "all") query = query.eq("status", filter);
    const { data, error } = await query;
    if (error) {
      toast.error(error.message);
      return;
    }
    const rows = (data as Req[]) ?? [];
    setReqs(rows);
    const ids = Array.from(new Set(rows.map((r) => r.user_id)));
    setProfiles(await loadUserInfos(ids));
  };
  useEffect(() => {
    load();
  }, [filter]);

  const saveAmount = async (r: Req) => {
    const raw = edits[r.id];
    const amount = Number(raw);
    if (raw === undefined || !Number.isFinite(amount) || amount < 0) {
      toast.error(tr("Montant invalide"));
      return;
    }
    const { error } = await supabase
      .from("payment_requests")
      .update({ amount_dzd: Math.round(amount) })
      .eq("id", r.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tr("Montant mis à jour"));
    setEdits((e) => {
      const c = { ...e };
      delete c[r.id];
      return c;
    });
    load();
  };

  const openProof = async (path: string) => {
    const { data, error } = await supabase.storage
      .from("payment-proofs")
      .createSignedUrl(path, 300);
    if (error) {
      toast.error(error.message);
      return;
    }
    window.open(data.signedUrl, "_blank");
  };

  const filtered = reqs.filter((r) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      (profiles[r.user_id]?.display_name ?? "").toLowerCase().includes(s) ||
      (profiles[r.user_id]?.email ?? "").toLowerCase().includes(s) ||
      r.user_id.toLowerCase().includes(s) ||
      (r.transaction_ref ?? "").toLowerCase().includes(s) ||
      r.method_kind.toLowerCase().includes(s)
    );
  });

  const approved = reqs.filter((r) => r.status === "approved");
  const rejected = reqs.filter((r) => r.status === "rejected");
  const totalApproved = approved.reduce((s, r) => s + Number(r.amount_dzd || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">{tr("Approuvées")}</div>
            <div className="text-2xl font-semibold">{approved.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">{tr("Rejetées")}</div>
            <div className="text-2xl font-semibold">{rejected.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">{tr("Total encaissé")}</div>
            <div className="text-2xl font-semibold">
              {new Intl.NumberFormat("fr-FR").format(totalApproved)} DZD
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base">
            {tr("Historique")} ({filtered.length})
          </CardTitle>
          <div className="flex items-center gap-2">
            <Input
              placeholder={tr("Filtrer (nom, référence, méthode…)")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-[240px]"
            />
            <Select value={filter} onValueChange={(v: any) => setFilter(v)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tr("Toutes")}</SelectItem>
                <SelectItem value="approved">{tr("Approuvées")}</SelectItem>
                <SelectItem value="rejected">{tr("Rejetées")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">{tr("Aucune entrée.")}</p>
          )}
          {filtered.map((r) => (
            <div key={r.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="font-medium space-y-0.5">
                    <UserLine info={profiles[r.user_id]} userId={r.user_id} />
                    <div>
                      {r.is_bundle ? tr("Pack complet") : `${tr("Année")} ${r.year}`} ·{" "}
                      {r.scope === "lessons"
                        ? tr("Cours seuls")
                        : r.scope === "sessions"
                          ? tr("Sessions seules")
                          : tr("Les deux")}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {new Intl.NumberFormat("fr-FR").format(r.amount_dzd)} DZD · {r.method_kind} ·{" "}
                    {new Date(r.created_at).toLocaleString("fr-FR")}
                  </div>
                </div>
                {r.status === "approved" ? (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">{tr("Approuvée")}</Badge>
                ) : (
                  <Badge variant="destructive">{tr("Rejetée")}</Badge>
                )}
              </div>
              {r.transaction_ref && (
                <div className="text-sm">
                  {tr("Référence")} :{" "}
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                    {r.transaction_ref}
                  </code>
                </div>
              )}
              {r.note && (
                <div className="text-sm text-muted-foreground">
                  {tr("Note")} : {r.note}
                </div>
              )}
              {r.reject_reason && (
                <div className="text-sm text-destructive">
                  {tr("Motif")} : {r.reject_reason}
                </div>
              )}
              {isSuper && (
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Montant encaissé (DZD)")}</Label>
                    <Input
                      type="number"
                      className="w-32"
                      value={edits[r.id] ?? String(r.amount_dzd)}
                      onChange={(e) => setEdits({ ...edits, [r.id]: e.target.value })}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => saveAmount(r)}
                    disabled={edits[r.id] === undefined || Number(edits[r.id]) === r.amount_dzd}
                  >
                    <Save className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Enregistrer")}
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    {tr("Mettre 0 pour un accès offert (exclu du total).")}
                  </span>
                </div>
              )}
              {r.proof_path && (
                <Button size="sm" variant="outline" onClick={() => openProof(r.proof_path!)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  {tr("Voir la preuve")}
                </Button>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
