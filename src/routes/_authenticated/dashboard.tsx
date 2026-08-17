import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LogOut, BookOpen, Settings, Shield, ShoppingBag, Lock, Brain } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-admin";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Tableau de bord — Portail de Révision" }] }),
  component: Dashboard,
});

type Profile = { display_name: string | null; avatar_url: string | null; current_year: number | null };
type Module = { id: string; slug: string; title: string; description: string | null; year: number; icon: string | null; color: string | null };
type PaymentRequest = { id: string; is_bundle: boolean; year: number | null; amount_dzd: number; status: string; created_at: string; transaction_ref: string | null; proof_path: string | null };

function Dashboard() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const { t, tr } = useI18n();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [email, setEmail] = useState("");
  const [modules, setModules] = useState<Module[]>([]);
  const [year, setYear] = useState<number>(1);
  const [unlockedYears, setUnlockedYears] = useState<number[]>([]);
  const [entitlementsLoaded, setEntitlementsLoaded] = useState(false);
  const [recentRequests, setRecentRequests] = useState<PaymentRequest[]>([]);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      setEmail(u.user.email ?? "");
      const { data: p } = await supabase.from("profiles").select("display_name, avatar_url, current_year").eq("id", u.user.id).maybeSingle();
      setProfile(p ?? null);
      const { data: ents } = await supabase.from("user_entitlements").select("year, is_bundle").eq("user_id", u.user.id);
      const hasBundle = (ents ?? []).some((e: any) => e.is_bundle);
      const years = hasBundle ? [1,2,3,4,5,6] : Array.from(new Set((ents ?? []).map((e: any) => e.year).filter((y: any) => y != null))).sort() as number[];
      // admins see everything
      const { data: adminCheck } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
      const finalYears = adminCheck ? [1,2,3,4,5,6] : years;
      setUnlockedYears(finalYears);
      setEntitlementsLoaded(true);
      if (finalYears.length > 0) {
        setYear(p?.current_year && finalYears.includes(p.current_year) ? p.current_year : finalYears[0]);
      }
      const { data: reqs } = await supabase.from("payment_requests")
        .select("id, is_bundle, year, amount_dzd, status, created_at, transaction_ref, proof_path")
        .eq("user_id", u.user.id).order("created_at", { ascending: false }).limit(5);
      setRecentRequests((reqs as PaymentRequest[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!unlockedYears.includes(year)) { setModules([]); return; }
      const { data } = await supabase.from("modules").select("*").eq("year", year).order("sort_order").order("title");
      setModules((data as Module[]) ?? []);
    })();
  }, [year, unlockedYears]);

  const signOut = async () => { await supabase.auth.signOut(); navigate({ to: "/", replace: true }); };
  const name = profile?.display_name ?? email.split("@")[0] ?? "Étudiant";

  const openProof = async (path: string) => {
    const { data, error } = await supabase.storage.from("payment-proofs").createSignedUrl(path, 300);
    if (error) return;
    window.open(data.signedUrl, "_blank");
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 backdrop-blur-sm bg-background/40 sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div>
            <p className="eyebrow flex items-center gap-1.5"><img src="/logo-mark.svg" alt="" className="h-4 w-4" />Med Apex</p>
            <h1 className="text-lg font-semibold">{t("hello")}, {name}</h1>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Button asChild variant="outline" size="sm"><Link to="/store"><ShoppingBag className="mr-1.5 h-4 w-4" />{t("store")}</Link></Button>
            <Button asChild variant="outline" size="sm"><Link to="/questions"><Brain className="mr-1.5 h-4 w-4" />{t("questions")}</Link></Button>
            {isAdmin && (
              <Button asChild variant="outline" size="sm"><Link to="/admin"><Shield className="mr-1.5 h-4 w-4" />{t("admin")}</Link></Button>
            )}
            <Button asChild variant="ghost" size="sm"><Link to="/profile"><Settings className="mr-1.5 h-4 w-4" />{t("profile")}</Link></Button>
            <Button variant="ghost" size="sm" onClick={signOut}><LogOut className="mr-1.5 h-4 w-4" />{t("signout")}</Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        {entitlementsLoaded && unlockedYears.length === 0 ? (
          <Card><CardContent className="py-16 text-center space-y-4">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-muted-foreground">{tr("Vous n'avez encore accès à aucune année.")}</p>
            <Button asChild><Link to="/store"><ShoppingBag className="mr-1.5 h-4 w-4" />{tr("Voir la boutique")}</Link></Button>
          </CardContent></Card>
        ) : (
        <>
        <div className="mb-6 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <p className="eyebrow mb-1">{tr("Vos modules")}</p>
            <h2 className="text-3xl font-semibold tracking-tight">{tr("Continuez votre préparation")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tr("Années débloquées")}</p>
          </div>
          <Tabs value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <TabsList>
              {unlockedYears.map((y) => (
                <TabsTrigger key={y} value={String(y)}>{tr("Année")} {y}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        {modules.length === 0 ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            {tr("Aucun module pour l'année {n} pour le moment.").replace("{n}", String(year))}
            {isAdmin && <div className="mt-4"><Button asChild size="sm"><Link to="/admin">{tr("Ajouter un module")}</Link></Button></div>}
          </CardContent></Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <Link key={m.id} to="/modules/$moduleId" params={{ moduleId: m.id }}>
                <Card className="h-full transition hover:shadow-md hover:-translate-y-0.5">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg text-xl" style={{ background: m.color ?? "hsl(var(--muted))" }}>
                        {m.icon ?? <BookOpen className="h-5 w-5" />}
                      </div>
                      <CardTitle className="text-base">{m.title}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent><CardDescription>{m.description}</CardDescription></CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
        </>
        )}

        {recentRequests.length > 0 && (
          <section className="mt-12">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold">{tr("Mes paiements récents")}</h2>
              <Button asChild variant="ghost" size="sm"><Link to="/store">{tr("Voir tout")}</Link></Button>
            </div>
            <Card><CardContent className="p-0 divide-y">
              {recentRequests.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium">{r.is_bundle ? tr("Pack complet") : `${tr("Année")} ${r.year}`} — {new Intl.NumberFormat("fr-FR").format(r.amount_dzd)} DZD</div>
                    <div className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleString("fr-FR")}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground space-x-2">
                      {r.transaction_ref && <span>{tr("Réf")} : <code className="bg-muted px-1 rounded">{r.transaction_ref}</code></span>}
                      {r.proof_path && (
                        <button onClick={() => openProof(r.proof_path!)} className="text-primary hover:underline">{tr("Voir la preuve")}</button>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full ${
                    r.status === "approved" ? "bg-emerald-100 text-emerald-700" :
                    r.status === "rejected" ? "bg-destructive/10 text-destructive" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {r.status === "approved" ? tr("Approuvée") : r.status === "rejected" ? tr("Rejetée") : tr("En attente")}
                  </span>
                </div>
              ))}
            </CardContent></Card>
          </section>
        )}
      </main>
    </div>
  );
}