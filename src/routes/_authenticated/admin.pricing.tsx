import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  head: () => ({ meta: [{ title: "Tarifs — Admin" }] }),
  component: PricingAdmin,
});

type YearPrice = {
  year: number;
  price_dzd: number; sale_price_dzd: number | null; on_sale: boolean;
  lessons_price_dzd: number; lessons_sale_price_dzd: number | null; lessons_on_sale: boolean;
  sessions_price_dzd: number; sessions_sale_price_dzd: number | null; sessions_on_sale: boolean;
};
type Config = {
  bundle_price_dzd: number; bundle_sale_price_dzd: number | null; bundle_on_sale: boolean; currency: string;
  bundle_lessons_price_dzd: number; bundle_lessons_sale_price_dzd: number | null; bundle_lessons_on_sale: boolean;
  bundle_sessions_price_dzd: number; bundle_sessions_sale_price_dzd: number | null; bundle_sessions_on_sale: boolean;
};

const EMPTY_CONFIG: Config = {
  bundle_price_dzd: 0, bundle_sale_price_dzd: null, bundle_on_sale: false, currency: "DZD",
  bundle_lessons_price_dzd: 0, bundle_lessons_sale_price_dzd: null, bundle_lessons_on_sale: false,
  bundle_sessions_price_dzd: 0, bundle_sessions_sale_price_dzd: null, bundle_sessions_on_sale: false,
};


function PriceRow({ label, price, sale, on, onChange }: {
  label: string; price: number; sale: number | null; on: boolean;
  onChange: (patch: { price?: number; sale?: number | null; on?: boolean }) => void;
}) {
  const { tr } = useI18n();
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label>{tr("Prix")}</Label>
          <Input type="number" value={price} onChange={(e) => onChange({ price: Number(e.target.value) || 0 })} />
        </div>
        <div className="space-y-1"><Label>{tr("Prix promo")}</Label>
          <Input type="number" value={sale ?? ""} onChange={(e) => onChange({ sale: e.target.value === "" ? null : Number(e.target.value) })} />
        </div>
        <div className="space-y-1"><Label>{tr("En promo")}</Label>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={on} onCheckedChange={(v) => onChange({ on: v })} />
            <span className="text-sm text-muted-foreground">{on ? tr("Actif") : tr("Inactif")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function PricingAdmin() {
  const { loading, isSuper, has } = useAdminPermissions();
  const { tr } = useI18n();
  const [prices, setPrices] = useState<YearPrice[]>([]);
  const [config, setConfig] = useState<Config | null>(null);

  const load = async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("year_prices").select("*").order("year"),
      supabase.from("pricing_config").select("*").eq("id", 1).maybeSingle(),
    ]);
    setPrices((p as YearPrice[]) ?? []);
    setConfig((c as Config) ?? EMPTY_CONFIG);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper && !has("manage_pricing")) return <div className="p-10 text-center text-muted-foreground">{tr("Permission requise : gestion des tarifs.")}</div>;

  const saveYear = async (yp: YearPrice) => {
    const { data, error } = await supabase.from("year_prices").upsert({
      year: yp.year,
      price_dzd: yp.price_dzd, sale_price_dzd: yp.sale_price_dzd, on_sale: yp.on_sale,
      lessons_price_dzd: yp.lessons_price_dzd, lessons_sale_price_dzd: yp.lessons_sale_price_dzd, lessons_on_sale: yp.lessons_on_sale,
      sessions_price_dzd: yp.sessions_price_dzd, sessions_sale_price_dzd: yp.sessions_sale_price_dzd, sessions_on_sale: yp.sessions_on_sale,
    }, { onConflict: "year" }).select("year");
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error(tr("Permission requise : gestion des tarifs."));
      return;
    }
    toast.success(`${tr("Année")} ${yp.year} ${tr("enregistrée")}`);
    await load();
  };

  const saveConfig = async () => {
    if (!config) return;
    const { data, error } = await supabase.from("pricing_config").upsert({
      id: 1,
      bundle_price_dzd: config.bundle_price_dzd, bundle_sale_price_dzd: config.bundle_sale_price_dzd,
      bundle_on_sale: config.bundle_on_sale, currency: config.currency,
      bundle_lessons_price_dzd: config.bundle_lessons_price_dzd,
      bundle_lessons_sale_price_dzd: config.bundle_lessons_sale_price_dzd,
      bundle_lessons_on_sale: config.bundle_lessons_on_sale,
      bundle_sessions_price_dzd: config.bundle_sessions_price_dzd,
      bundle_sessions_sale_price_dzd: config.bundle_sessions_sale_price_dzd,
      bundle_sessions_on_sale: config.bundle_sessions_on_sale,
    }, { onConflict: "id" }).select("id");
    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error(tr("Permission requise : gestion des tarifs."));
      return;
    }
    toast.success(tr("Pack enregistré"));
    await load();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/admin"><ArrowLeft className="mr-1.5 h-4 w-4" />{tr("Admin")}</Link></Button>
        <h1 className="text-lg font-semibold">{tr("Tarifs")}</h1>
        <div />
      </div></header>
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {config && (
          <Card>
            <CardHeader><CardTitle>{tr("Pack complet (6 années)")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <PriceRow label={tr("Cours seuls")} price={config.bundle_lessons_price_dzd} sale={config.bundle_lessons_sale_price_dzd} on={config.bundle_lessons_on_sale}
                onChange={(p) => setConfig({ ...config,
                  ...(p.price !== undefined ? { bundle_lessons_price_dzd: p.price } : {}),
                  ...(p.sale !== undefined ? { bundle_lessons_sale_price_dzd: p.sale } : {}),
                  ...(p.on !== undefined ? { bundle_lessons_on_sale: p.on } : {}) })} />
              <PriceRow label={tr("Sessions seules")} price={config.bundle_sessions_price_dzd} sale={config.bundle_sessions_sale_price_dzd} on={config.bundle_sessions_on_sale}
                onChange={(p) => setConfig({ ...config,
                  ...(p.price !== undefined ? { bundle_sessions_price_dzd: p.price } : {}),
                  ...(p.sale !== undefined ? { bundle_sessions_sale_price_dzd: p.sale } : {}),
                  ...(p.on !== undefined ? { bundle_sessions_on_sale: p.on } : {}) })} />
              <PriceRow label={tr("Les deux")} price={config.bundle_price_dzd} sale={config.bundle_sale_price_dzd} on={config.bundle_on_sale}
                onChange={(p) => setConfig({ ...config,
                  ...(p.price !== undefined ? { bundle_price_dzd: p.price } : {}),
                  ...(p.sale !== undefined ? { bundle_sale_price_dzd: p.sale } : {}),
                  ...(p.on !== undefined ? { bundle_on_sale: p.on } : {}) })} />
              <div className="space-y-1 max-w-[200px]"><Label>{tr("Devise")}</Label>
                <Input value={config.currency} onChange={(e) => setConfig({ ...config, currency: e.target.value.toUpperCase() })} maxLength={5} />
              </div>
              <Button onClick={saveConfig}><Save className="mr-1.5 h-4 w-4" />{tr("Enregistrer")}</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{tr("Prix par année")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {prices.map((yp, idx) => (
              <div key={yp.year} className="rounded-lg border p-4 space-y-3">
                <div className="font-medium">{tr("Année")} {yp.year}</div>
                <PriceRow label={tr("Cours seuls")} price={yp.lessons_price_dzd} sale={yp.lessons_sale_price_dzd} on={yp.lessons_on_sale}
                  onChange={(p) => { const v = [...prices]; v[idx] = { ...yp,
                    ...(p.price !== undefined ? { lessons_price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { lessons_sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { lessons_on_sale: p.on } : {}) }; setPrices(v); }} />
                <PriceRow label={tr("Sessions seules")} price={yp.sessions_price_dzd} sale={yp.sessions_sale_price_dzd} on={yp.sessions_on_sale}
                  onChange={(p) => { const v = [...prices]; v[idx] = { ...yp,
                    ...(p.price !== undefined ? { sessions_price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { sessions_sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { sessions_on_sale: p.on } : {}) }; setPrices(v); }} />
                <PriceRow label={tr("Les deux")} price={yp.price_dzd} sale={yp.sale_price_dzd} on={yp.on_sale}
                  onChange={(p) => { const v = [...prices]; v[idx] = { ...yp,
                    ...(p.price !== undefined ? { price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { on_sale: p.on } : {}) }; setPrices(v); }} />
                <div><Button size="sm" onClick={() => saveYear(yp)}><Save className="mr-1.5 h-4 w-4" />{tr("Enregistrer")}</Button></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}