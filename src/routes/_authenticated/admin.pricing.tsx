import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Save, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useConfirm } from "@/hooks/use-confirm";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_YEAR_DEADLINE, DEFAULT_BUNDLE_DEADLINE } from "@/lib/deadlines";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  head: () => ({ meta: [{ title: "Tarifs — Admin" }] }),
  component: PricingAdmin,
});

type YearPrice = {
  year: number;
  price_dzd: number;
  sale_price_dzd: number | null;
  on_sale: boolean;
  free: boolean;
  lessons_price_dzd: number;
  lessons_sale_price_dzd: number | null;
  lessons_on_sale: boolean;
  lessons_free: boolean;
  sessions_price_dzd: number;
  sessions_sale_price_dzd: number | null;
  sessions_on_sale: boolean;
  sessions_free: boolean;
};
type Config = {
  bundle_price_dzd: number;
  bundle_sale_price_dzd: number | null;
  bundle_on_sale: boolean;
  bundle_free: boolean;
  currency: string;
  bundle_lessons_price_dzd: number;
  bundle_lessons_sale_price_dzd: number | null;
  bundle_lessons_on_sale: boolean;
  bundle_lessons_free: boolean;
  bundle_sessions_price_dzd: number;
  bundle_sessions_sale_price_dzd: number | null;
  bundle_sessions_on_sale: boolean;
  bundle_sessions_free: boolean;
  // The deadlines every access grant is stamped with — a purchase, a free-
  // offer claim, or a manual admin grant — and that close paid Store sales
  // once passed. They apply to every user, new or existing; see
  // src/lib/deadlines.ts.
  year_deadline: string;
  bundle_deadline: string;
};

const EMPTY_CONFIG: Config = {
  bundle_price_dzd: 0,
  bundle_sale_price_dzd: null,
  bundle_on_sale: false,
  bundle_free: false,
  currency: "DZD",
  bundle_lessons_price_dzd: 0,
  bundle_lessons_sale_price_dzd: null,
  bundle_lessons_on_sale: false,
  bundle_lessons_free: false,
  bundle_sessions_price_dzd: 0,
  bundle_sessions_sale_price_dzd: null,
  bundle_sessions_on_sale: false,
  bundle_sessions_free: false,
  year_deadline: DEFAULT_YEAR_DEADLINE.toISOString(),
  bundle_deadline: DEFAULT_BUNDLE_DEADLINE.toISOString(),
};

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function PriceRow({
  label,
  price,
  sale,
  on,
  free,
  onChange,
}: {
  label: string;
  price: number;
  sale: number | null;
  on: boolean;
  free: boolean;
  onChange: (patch: { price?: number; sale?: number | null; on?: boolean; free?: boolean }) => void;
}) {
  const { tr } = useI18n();
  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="space-y-1">
          <Label>{tr("Prix")}</Label>
          <Input
            type="number"
            value={price}
            disabled={free}
            onChange={(e) => onChange({ price: Number(e.target.value) || 0 })}
          />
        </div>
        <div className="space-y-1">
          <Label>{tr("Prix promo")}</Label>
          <Input
            type="number"
            value={sale ?? ""}
            disabled={free}
            onChange={(e) =>
              onChange({ sale: e.target.value === "" ? null : Number(e.target.value) })
            }
          />
        </div>
        <div className="space-y-1">
          <Label>{tr("En promo")}</Label>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={on} disabled={free} onCheckedChange={(v) => onChange({ on: v })} />
            <span className="text-sm text-muted-foreground">
              {on ? tr("Actif") : tr("Inactif")}
            </span>
          </div>
        </div>
        <div className="space-y-1">
          <Label>{tr("Gratuit")}</Label>
          <div className="flex items-center gap-2 h-9">
            <Switch checked={free} onCheckedChange={(v) => onChange({ free: v })} />
            <span className="text-sm text-muted-foreground">
              {free ? tr("Offert") : tr("Payant")}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DeadlineGroup({
  title,
  newValue,
  onNewChange,
  oldValue,
  onOldChange,
  onApplyOld,
  applyingOld,
}: {
  title: string;
  newValue: string;
  onNewChange: (v: string) => void;
  oldValue: string;
  onOldChange: (v: string) => void;
  onApplyOld: () => void;
  applyingOld: boolean;
}) {
  const { tr } = useI18n();
  return (
    <div className="rounded-md border p-3 space-y-4">
      <div className="text-sm font-medium">{title}</div>
      <div className="space-y-1">
        <Label>{tr("Nouveaux abonnements")}</Label>
        <Input
          type="datetime-local"
          value={newValue}
          onChange={(e) => onNewChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {tr(
            "S'applique à tout accès accordé à partir de maintenant : achat, offre gratuite ou octroi manuel. Ferme aussi les nouveaux achats payants une fois dépassée.",
          )}
        </p>
      </div>
      <div className="space-y-1">
        <Label>{tr("Abonnements existants")}</Label>
        <Input
          type="datetime-local"
          value={oldValue}
          onChange={(e) => onOldChange(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          {tr(
            "Ne change rien tant que vous ne cliquez pas sur « Appliquer » : retime alors tous les abonnements déjà accordés de cette formule (sauf ceux marqués « Sans expiration »).",
          )}
        </p>
        <Button size="sm" variant="outline" onClick={onApplyOld} disabled={applyingOld}>
          {applyingOld ? tr("Application…") : tr("Appliquer aux abonnements existants")}
        </Button>
      </div>
    </div>
  );
}

function PricingAdmin() {
  const { loading, isSuper, has } = useAdminPermissions();
  const { tr } = useI18n();
  const confirm = useConfirm();
  const [prices, setPrices] = useState<YearPrice[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  // "Nouveaux abonnements" edits config.year_deadline/bundle_deadline
  // directly (saved via saveConfig, below). "Abonnements existants" is a
  // one-off bulk action, not a stored setting, so it gets its own local
  // input seeded from the current config once it loads.
  const [oldYearValue, setOldYearValue] = useState("");
  const [oldBundleValue, setOldBundleValue] = useState("");
  const [applyingOldYear, setApplyingOldYear] = useState(false);
  const [applyingOldBundle, setApplyingOldBundle] = useState(false);

  const load = async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase.from("year_prices").select("*").order("year"),
      supabase.from("pricing_config").select("*").eq("id", 1).maybeSingle(),
    ]);
    setPrices((p as unknown as YearPrice[]) ?? []);
    const cfg = (c as unknown as Config) ?? EMPTY_CONFIG;
    setConfig(cfg);
    setOldYearValue((v) => v || toLocalInput(new Date(cfg.year_deadline)));
    setOldBundleValue((v) => v || toLocalInput(new Date(cfg.bundle_deadline)));
  };
  useEffect(() => {
    load();
  }, []);

  // Bulk-retimes every currently granted entitlement of this kind — every
  // "old" subscription, whether free-claimed, paid, or manually granted.
  // Never touches a "Sans expiration" (lifetime) grant.
  const applyToExisting = async (isBundle: boolean, value: string) => {
    if (!value) return;
    const label = isBundle ? tr("Pack complet") : tr("Offres à l'année");
    if (
      !(await confirm(
        `${tr("Appliquer cette date à tous les abonnements existants")} — ${label} ?`,
        { variant: "destructive" },
      ))
    )
      return;
    const setBusy = isBundle ? setApplyingOldBundle : setApplyingOldYear;
    setBusy(true);
    const { error, count } = await supabase
      .from("user_entitlements")
      .update({ expires_at: new Date(value).toISOString() }, { count: "exact" })
      .eq("is_bundle", isBundle)
      .not("expires_at", "is", null);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${count ?? 0} ${tr("abonnement(s) mis à jour")}`);
  };

  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper && !has("manage_pricing"))
    return (
      <div className="p-10 text-center text-muted-foreground">
        {tr("Permission requise : gestion des tarifs.")}
      </div>
    );

  const saveYear = async (yp: YearPrice) => {
    const { data, error } = await (supabase as any)
      .from("year_prices")
      .upsert(
        {
          year: yp.year,
          price_dzd: yp.price_dzd,
          sale_price_dzd: yp.sale_price_dzd,
          on_sale: yp.on_sale,
          free: yp.free,
          lessons_price_dzd: yp.lessons_price_dzd,
          lessons_sale_price_dzd: yp.lessons_sale_price_dzd,
          lessons_on_sale: yp.lessons_on_sale,
          lessons_free: yp.lessons_free,
          sessions_price_dzd: yp.sessions_price_dzd,
          sessions_sale_price_dzd: yp.sessions_sale_price_dzd,
          sessions_on_sale: yp.sessions_on_sale,
          sessions_free: yp.sessions_free,
        },
        { onConflict: "year" },
      )
      .select("year");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error(tr("Permission requise : gestion des tarifs."));
      return;
    }
    toast.success(`${tr("Année")} ${yp.year} ${tr("enregistrée")}`);
  };

  const saveConfig = async () => {
    if (!config) return;
    const { data, error } = await (supabase as any)
      .from("pricing_config")
      .upsert(
        {
          id: 1,
          bundle_price_dzd: config.bundle_price_dzd,
          bundle_sale_price_dzd: config.bundle_sale_price_dzd,
          bundle_on_sale: config.bundle_on_sale,
          bundle_free: config.bundle_free,
          currency: config.currency,
          bundle_lessons_price_dzd: config.bundle_lessons_price_dzd,
          bundle_lessons_sale_price_dzd: config.bundle_lessons_sale_price_dzd,
          bundle_lessons_on_sale: config.bundle_lessons_on_sale,
          bundle_lessons_free: config.bundle_lessons_free,
          bundle_sessions_price_dzd: config.bundle_sessions_price_dzd,
          bundle_sessions_sale_price_dzd: config.bundle_sessions_sale_price_dzd,
          bundle_sessions_on_sale: config.bundle_sessions_on_sale,
          bundle_sessions_free: config.bundle_sessions_free,
          year_deadline: config.year_deadline,
          bundle_deadline: config.bundle_deadline,
        },
        { onConflict: "id" },
      )
      .select("id");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      toast.error(tr("Permission requise : gestion des tarifs."));
      return;
    }
    toast.success(tr("Pack enregistré"));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Admin")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{tr("Tarifs")}</h1>
          <div />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
        {config && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                {tr("Délais d'accès")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-muted-foreground">
                {tr(
                  "Deux formules, chacune avec deux boîtes : « Nouveaux abonnements » définit la date donnée à tout accès accordé à partir de maintenant et n'affecte jamais un abonnement déjà accordé ; « Abonnements existants » retime en une fois tous les abonnements déjà accordés de cette formule, sans toucher les nouveaux. Vous pouvez toujours changer la date d'un utilisateur précis depuis la page Accès.",
                )}
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <DeadlineGroup
                  title={tr("Offres à l'année")}
                  newValue={toLocalInput(new Date(config.year_deadline))}
                  onNewChange={(v) =>
                    setConfig({ ...config, year_deadline: new Date(v).toISOString() })
                  }
                  oldValue={oldYearValue}
                  onOldChange={setOldYearValue}
                  onApplyOld={() => applyToExisting(false, oldYearValue)}
                  applyingOld={applyingOldYear}
                />
                <DeadlineGroup
                  title={tr("Pack complet (6 années)")}
                  newValue={toLocalInput(new Date(config.bundle_deadline))}
                  onNewChange={(v) =>
                    setConfig({ ...config, bundle_deadline: new Date(v).toISOString() })
                  }
                  oldValue={oldBundleValue}
                  onOldChange={setOldBundleValue}
                  onApplyOld={() => applyToExisting(true, oldBundleValue)}
                  applyingOld={applyingOldBundle}
                />
              </div>
              <Button onClick={saveConfig}>
                <Save className="mr-1.5 h-4 w-4" />
                {tr("Enregistrer les nouveaux délais")}
              </Button>
            </CardContent>
          </Card>
        )}

        {config && (
          <Card>
            <CardHeader>
              <CardTitle>{tr("Pack complet (6 années)")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <PriceRow
                label={tr("Cours seuls")}
                price={config.bundle_lessons_price_dzd}
                sale={config.bundle_lessons_sale_price_dzd}
                on={config.bundle_lessons_on_sale}
                free={config.bundle_lessons_free}
                onChange={(p) =>
                  setConfig({
                    ...config,
                    ...(p.price !== undefined ? { bundle_lessons_price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { bundle_lessons_sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { bundle_lessons_on_sale: p.on } : {}),
                    ...(p.free !== undefined ? { bundle_lessons_free: p.free } : {}),
                  })
                }
              />
              <PriceRow
                label={tr("Sessions seules")}
                price={config.bundle_sessions_price_dzd}
                sale={config.bundle_sessions_sale_price_dzd}
                on={config.bundle_sessions_on_sale}
                free={config.bundle_sessions_free}
                onChange={(p) =>
                  setConfig({
                    ...config,
                    ...(p.price !== undefined ? { bundle_sessions_price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { bundle_sessions_sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { bundle_sessions_on_sale: p.on } : {}),
                    ...(p.free !== undefined ? { bundle_sessions_free: p.free } : {}),
                  })
                }
              />
              <PriceRow
                label={tr("Les deux")}
                price={config.bundle_price_dzd}
                sale={config.bundle_sale_price_dzd}
                on={config.bundle_on_sale}
                free={config.bundle_free}
                onChange={(p) =>
                  setConfig({
                    ...config,
                    ...(p.price !== undefined ? { bundle_price_dzd: p.price } : {}),
                    ...(p.sale !== undefined ? { bundle_sale_price_dzd: p.sale } : {}),
                    ...(p.on !== undefined ? { bundle_on_sale: p.on } : {}),
                    ...(p.free !== undefined ? { bundle_free: p.free } : {}),
                  })
                }
              />
              <div className="space-y-1 max-w-[200px]">
                <Label>{tr("Devise")}</Label>
                <Input
                  value={config.currency}
                  onChange={(e) => setConfig({ ...config, currency: e.target.value.toUpperCase() })}
                  maxLength={5}
                />
              </div>
              <Button onClick={saveConfig}>
                <Save className="mr-1.5 h-4 w-4" />
                {tr("Enregistrer")}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>{tr("Prix par année")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {prices.map((yp, idx) => (
              <div key={yp.year} className="rounded-lg border p-4 space-y-3">
                <div className="font-medium">
                  {tr("Année")} {yp.year}
                </div>
                <PriceRow
                  label={tr("Cours seuls")}
                  price={yp.lessons_price_dzd}
                  sale={yp.lessons_sale_price_dzd}
                  on={yp.lessons_on_sale}
                  free={yp.lessons_free}
                  onChange={(p) => {
                    const v = [...prices];
                    v[idx] = {
                      ...yp,
                      ...(p.price !== undefined ? { lessons_price_dzd: p.price } : {}),
                      ...(p.sale !== undefined ? { lessons_sale_price_dzd: p.sale } : {}),
                      ...(p.on !== undefined ? { lessons_on_sale: p.on } : {}),
                      ...(p.free !== undefined ? { lessons_free: p.free } : {}),
                    };
                    setPrices(v);
                  }}
                />
                <PriceRow
                  label={tr("Sessions seules")}
                  price={yp.sessions_price_dzd}
                  sale={yp.sessions_sale_price_dzd}
                  on={yp.sessions_on_sale}
                  free={yp.sessions_free}
                  onChange={(p) => {
                    const v = [...prices];
                    v[idx] = {
                      ...yp,
                      ...(p.price !== undefined ? { sessions_price_dzd: p.price } : {}),
                      ...(p.sale !== undefined ? { sessions_sale_price_dzd: p.sale } : {}),
                      ...(p.on !== undefined ? { sessions_on_sale: p.on } : {}),
                      ...(p.free !== undefined ? { sessions_free: p.free } : {}),
                    };
                    setPrices(v);
                  }}
                />
                <PriceRow
                  label={tr("Les deux")}
                  price={yp.price_dzd}
                  sale={yp.sale_price_dzd}
                  on={yp.on_sale}
                  free={yp.free}
                  onChange={(p) => {
                    const v = [...prices];
                    v[idx] = {
                      ...yp,
                      ...(p.price !== undefined ? { price_dzd: p.price } : {}),
                      ...(p.sale !== undefined ? { sale_price_dzd: p.sale } : {}),
                      ...(p.on !== undefined ? { on_sale: p.on } : {}),
                      ...(p.free !== undefined ? { free: p.free } : {}),
                    };
                    setPrices(v);
                  }}
                />
                <div>
                  <Button size="sm" onClick={() => saveYear(yp)}>
                    <Save className="mr-1.5 h-4 w-4" />
                    {tr("Enregistrer")}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
