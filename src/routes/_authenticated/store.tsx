import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ArrowLeft,
  Check,
  ShoppingBag,
  Sparkles,
  Copy,
  Clock,
  XCircle,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { YEAR_DEADLINE, BUNDLE_DEADLINE, isSalesClosed, formatDeadline } from "@/lib/deadlines";
import { useI18n } from "@/lib/i18n";
import { scopeLabel, owns as ownsScope, type AccessScope } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/store")({
  head: () => ({ meta: [{ title: "Store — Med Apex" }] }),
  component: StorePage,
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
};
type Entitlement = { year: number | null; is_bundle: boolean; scope: AccessScope };
type PaymentMethod = {
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
type PaymentRequest = {
  id: string;
  is_bundle: boolean;
  year: number | null;
  scope: AccessScope;
  amount_dzd: number;
  status: string;
  created_at: string;
  reject_reason: string | null;
  transaction_ref: string | null;
  proof_path: string | null;
  method_kind: string | null;
};
type Target = {
  is_bundle: boolean;
  year: number | null;
  scope: AccessScope;
  amount: number;
  label: string;
};

type Offer = { scope: AccessScope; price: number; base: number; onSale: boolean; free: boolean };

function yearOffers(p: YearPrice): Offer[] {
  return [
    {
      scope: "lessons" as const,
      base: p.lessons_price_dzd,
      sale: p.lessons_sale_price_dzd,
      on: p.lessons_on_sale,
      free: p.lessons_free,
    },
    {
      scope: "sessions" as const,
      base: p.sessions_price_dzd,
      sale: p.sessions_sale_price_dzd,
      on: p.sessions_on_sale,
      free: p.sessions_free,
    },
    {
      scope: "both" as const,
      base: p.price_dzd,
      sale: p.sale_price_dzd,
      on: p.on_sale,
      free: p.free,
    },
  ].map((o) => {
    const active = o.on && o.sale != null;
    return {
      scope: o.scope,
      base: o.base,
      onSale: active,
      free: o.free,
      price: active ? o.sale! : o.base,
    };
  });
}

function bundleOffers(c: Config): Offer[] {
  return [
    {
      scope: "lessons" as const,
      base: c.bundle_lessons_price_dzd,
      sale: c.bundle_lessons_sale_price_dzd,
      on: c.bundle_lessons_on_sale,
      free: c.bundle_lessons_free,
    },
    {
      scope: "sessions" as const,
      base: c.bundle_sessions_price_dzd,
      sale: c.bundle_sessions_sale_price_dzd,
      on: c.bundle_sessions_on_sale,
      free: c.bundle_sessions_free,
    },
    {
      scope: "both" as const,
      base: c.bundle_price_dzd,
      sale: c.bundle_sale_price_dzd,
      on: c.bundle_on_sale,
      free: c.bundle_free,
    },
  ].map((o) => {
    const active = o.on && o.sale != null;
    return {
      scope: o.scope,
      base: o.base,
      onSale: active,
      free: o.free,
      price: active ? o.sale! : o.base,
    };
  });
}

function fmt(n: number, currency: string, locale: string) {
  return new Intl.NumberFormat(locale).format(n) + " " + currency;
}

function StorePage() {
  const { t, lang } = useI18n();
  const locale = lang === "en" ? "en-US" : "fr-FR";
  const [prices, setPrices] = useState<YearPrice[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [ents, setEnts] = useState<Entitlement[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [buyTarget, setBuyTarget] = useState<Target | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = async () => {
    const [{ data: p }, { data: c }, { data: u }, { data: m }] = await Promise.all([
      supabase.from("year_prices").select("*").order("year"),
      supabase.from("pricing_config").select("*").eq("id", 1).maybeSingle(),
      supabase.auth.getUser(),
      supabase.rpc("list_active_payment_methods"),
    ]);
    setPrices((p as unknown as YearPrice[]) ?? []);
    setConfig((c as unknown as Config) ?? null);
    setMethods((m as PaymentMethod[]) ?? []);
    if (u.user) {
      setUserId(u.user.id);
      const { data: e } = await supabase
        .from("user_entitlements")
        .select("year, is_bundle, scope")
        .eq("user_id", u.user.id);
      setEnts((e as Entitlement[]) ?? []);
      const { data: r } = await supabase
        .from("payment_requests")
        .select(
          "id, is_bundle, year, scope, amount_dzd, status, created_at, reject_reason, transaction_ref, proof_path, method_kind",
        )
        .eq("user_id", u.user.id)
        .order("created_at", { ascending: false });
      setRequests((r as PaymentRequest[]) ?? []);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const owns = (isBundle: boolean, y: number | null, scope: AccessScope) =>
    ownsScope(ents, isBundle, y, scope);
  const pendingFor = (isBundle: boolean, y: number | null, scope: AccessScope) =>
    requests.find(
      (r) =>
        r.status === "pending" && r.is_bundle === isBundle && r.year === y && r.scope === scope,
    );
  const currency = config?.currency ?? "DZD";

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

  const claimFree = async (isBundle: boolean, year: number | null, scope: AccessScope) => {
    const key = `${isBundle ? "bundle" : year}-${scope}`;
    setClaiming(key);
    try {
      const { error } = await (supabase as any).rpc("claim_free_offer", {
        _is_bundle: isBundle,
        _year: year,
        _scope: scope,
      });
      if (error) throw error;
      toast.success(t("free_offer_claimed"));
      await load();
    } catch (e: any) {
      toast.error(e.message ?? t("error"));
    } finally {
      setClaiming(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("dashboard")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <ShoppingBag className="h-5 w-5" />
            {t("store_title")}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10 space-y-10">
        {config && (
          <Card className="border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Sparkles className="h-5 w-5 text-primary" />
                {t("bundle_title")}
              </CardTitle>
              <CardDescription>{t("bundle_desc")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3">
                {bundleOffers(config).map((o) => {
                  const owned = owns(true, null, o.scope);
                  const pending = pendingFor(true, null, o.scope);
                  const closed = isSalesClosed(true);
                  const isClaiming = claiming === `bundle-${o.scope}`;
                  return (
                    <div key={o.scope} className="rounded-lg border bg-background/60 p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{scopeLabel(o.scope, lang)}</span>
                        {o.free && !owned && (
                          <Badge className="bg-emerald-600 hover:bg-emerald-600">{t("free")}</Badge>
                        )}
                        {!o.free && o.onSale && !owned && <Badge>{t("promo")}</Badge>}
                        {owned && (
                          <Badge variant="secondary">
                            <Check className="h-3 w-3 mr-1" />
                            {t("possessed")}
                          </Badge>
                        )}
                      </div>
                      <div>
                        {o.free ? (
                          <div className="text-xl font-bold text-emerald-600">{t("free")}</div>
                        ) : (
                          <>
                            {o.onSale && !owned && (
                              <div className="text-xs text-muted-foreground line-through">
                                {fmt(o.base, currency, locale)}
                              </div>
                            )}
                            <div className="text-xl font-bold">
                              {fmt(o.price, currency, locale)}
                            </div>
                          </>
                        )}
                      </div>
                      {o.free ? (
                        <Button
                          className="w-full"
                          disabled={owned || isClaiming}
                          variant={o.scope === "both" ? "default" : "outline"}
                          onClick={() => claimFree(true, null, o.scope)}
                        >
                          {owned ? t("owned") : isClaiming ? t("sending") : t("claim_free")}
                        </Button>
                      ) : (
                        <Button
                          className="w-full"
                          disabled={owned || !!pending || closed}
                          variant={o.scope === "both" ? "default" : "outline"}
                          onClick={() =>
                            setBuyTarget({
                              is_bundle: true,
                              year: null,
                              scope: o.scope,
                              amount: o.price,
                              label: `${t("bundle_title")} — ${scopeLabel(o.scope, lang)}`,
                            })
                          }
                        >
                          {owned
                            ? t("owned")
                            : pending
                              ? t("pending_request")
                              : closed
                                ? t("offer_closed")
                                : t("buy_pack")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground">
                {t("offer_valid_until")} {formatDeadline(BUNDLE_DEADLINE)}.
              </p>
            </CardContent>
          </Card>
        )}

        <div>
          <div className="mb-3 flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">{t("or_year_by_year")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("offers_valid_until")} {formatDeadline(YEAR_DEADLINE)}.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {prices.map((p) => {
              const closed = isSalesClosed(false);
              const offers = yearOffers(p);
              return (
                <Card key={p.year}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">
                        {t("year")} {p.year}
                      </CardTitle>
                      {owns(false, p.year, "both") && (
                        <Badge variant="secondary">
                          <Check className="h-3 w-3 mr-1" />
                          {t("possessed")}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {offers.map((o) => {
                      const owned = owns(false, p.year, o.scope);
                      const pending = pendingFor(false, p.year, o.scope);
                      const isClaiming = claiming === `${p.year}-${o.scope}`;
                      return (
                        <div key={o.scope} className="rounded-md border px-3 py-2 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{scopeLabel(o.scope, lang)}</span>
                            <div className="text-right">
                              {o.free ? (
                                <div className="text-sm font-bold text-emerald-600">
                                  {t("free")}
                                </div>
                              ) : (
                                <>
                                  {o.onSale && !owned && (
                                    <div className="text-[11px] text-muted-foreground line-through">
                                      {fmt(o.base, currency, locale)}
                                    </div>
                                  )}
                                  <div className="text-sm font-bold">
                                    {fmt(o.price, currency, locale)}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                          {o.free ? (
                            <Button
                              size="sm"
                              className="w-full"
                              variant={o.scope === "both" ? "default" : "outline"}
                              disabled={owned || isClaiming}
                              onClick={() => claimFree(false, p.year, o.scope)}
                            >
                              {owned ? t("unlocked") : isClaiming ? t("sending") : t("claim_free")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              className="w-full"
                              variant={o.scope === "both" ? "default" : "outline"}
                              disabled={owned || !!pending || closed}
                              onClick={() =>
                                setBuyTarget({
                                  is_bundle: false,
                                  year: p.year,
                                  scope: o.scope,
                                  amount: o.price,
                                  label: `${t("year")} ${p.year} — ${scopeLabel(o.scope, lang)}`,
                                })
                              }
                            >
                              {owned
                                ? t("unlocked")
                                : pending
                                  ? t("pending_validation")
                                  : closed
                                    ? t("offer_closed")
                                    : t("buy")}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {requests.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-3">{t("my_payment_requests")}</h2>
            <div className="space-y-2">
              {requests.map((r) => (
                <div key={r.id} className="rounded-lg border px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {r.is_bundle ? t("bundle_short") : `${t("year")} ${r.year}`} —{" "}
                        {fmt(r.amount_dzd, currency, locale)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(r.created_at).toLocaleString(locale)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
                        {r.method_kind && (
                          <div>
                            {t("method")} : <span className="text-foreground">{r.method_kind}</span>
                          </div>
                        )}
                        {r.transaction_ref && (
                          <div>
                            {t("reference")} :{" "}
                            <code className="bg-muted px-1.5 py-0.5 rounded">
                              {r.transaction_ref}
                            </code>
                          </div>
                        )}
                        {r.proof_path && (
                          <button
                            onClick={() => openProof(r.proof_path!)}
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                          >
                            <ExternalLink className="h-3 w-3" />
                            {t("view_proof")}
                          </button>
                        )}
                      </div>
                      {r.status === "rejected" && r.reject_reason && (
                        <div className="text-xs text-destructive mt-1">
                          {t("reason")} : {r.reject_reason}
                        </div>
                      )}
                    </div>
                    <div>
                      {r.status === "pending" && (
                        <Badge variant="outline">
                          <Clock className="h-3 w-3 mr-1" />
                          {t("pending")}
                        </Badge>
                      )}
                      {r.status === "approved" && (
                        <Badge className="bg-emerald-600 hover:bg-emerald-600">
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          {t("approved")}
                        </Badge>
                      )}
                      {r.status === "rejected" && (
                        <Badge variant="destructive">
                          <XCircle className="h-3 w-3 mr-1" />
                          {t("rejected")}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      <PaymentDialog
        target={buyTarget}
        onClose={() => setBuyTarget(null)}
        methods={methods}
        currency={currency}
        locale={locale}
        userId={userId}
        onSubmitted={load}
      />
    </div>
  );
}

function PaymentDialog({
  target,
  onClose,
  methods,
  currency,
  locale,
  userId,
  onSubmitted,
}: {
  target: Target | null;
  onClose: () => void;
  methods: PaymentMethod[];
  currency: string;
  locale: string;
  userId: string | null;
  onSubmitted: () => void;
}) {
  const { t } = useI18n();
  const [methodKind, setMethodKind] = useState<string>("");
  const [txRef, setTxRef] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target && methods.length && !methodKind) setMethodKind(methods[0].kind);
  }, [target, methods, methodKind]);

  useEffect(() => {
    if (!target) {
      setTxRef("");
      setNote("");
      setFile(null);
      setMethodKind("");
    }
  }, [target]);

  if (!target) return null;

  const copy = (v: string) => {
    navigator.clipboard.writeText(v);
    toast.success(t("copied"));
  };

  const submit = async () => {
    if (!userId) {
      toast.error(t("not_authenticated"));
      return;
    }
    if (!methodKind) {
      toast.error(t("choose_method"));
      return;
    }
    if (!txRef.trim() && !file) {
      toast.error(t("provide_ref_or_screenshot"));
      return;
    }
    setSubmitting(true);
    try {
      let proofPath: string | null = null;
      if (file) {
        const ext = file.name.split(".").pop() || "bin";
        const path = `${userId}/${Date.now()}.${ext}`;
        const up = await supabase.storage
          .from("payment-proofs")
          .upload(path, file, { upsert: false });
        if (up.error) throw up.error;
        proofPath = path;
      }
      const { error } = await supabase.from("payment_requests").insert({
        user_id: userId,
        is_bundle: target.is_bundle,
        year: target.is_bundle ? null : target.year,
        scope: target.scope,
        // amount_dzd is intentionally NOT sent: it is computed server-side from
        // year_prices / pricing_config by a BEFORE INSERT trigger so a client
        // can never declare a fake price.
        method_kind: methodKind,
        transaction_ref: txRef.trim() || null,
        proof_path: proofPath,
        note: note.trim() || null,
      });
      if (error) throw error;
      toast.success(t("request_sent"));
      onClose();
      onSubmitted();
    } catch (e: any) {
      toast.error(e.message || t("error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {t("pay")} : {target.label}
          </DialogTitle>
          <DialogDescription>
            {t("amount_to_pay")} :{" "}
            <span className="font-semibold text-foreground">
              {new Intl.NumberFormat(locale).format(target.amount) + " " + currency}
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="mb-2 block">{t("step_choose_method")}</Label>
            <div className="grid gap-2">
              {methods.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("no_methods")}</p>
              )}
              {methods.map((m) => (
                <label
                  key={m.id}
                  className={`rounded-lg border p-3 cursor-pointer text-sm ${methodKind === m.kind ? "border-primary bg-accent" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="pm"
                      className="mt-1"
                      checked={methodKind === m.kind}
                      onChange={() => setMethodKind(m.kind)}
                    />
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("beneficiary")} :{" "}
                        <span className="text-foreground">{m.account_holder}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs bg-muted px-2 py-1 rounded flex-1 break-all">
                          {m.account_number}
                        </code>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            copy(m.account_number);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {m.extra && <div className="text-xs text-muted-foreground">{m.extra}</div>}
                      {m.instructions && (
                        <div className="text-xs text-muted-foreground italic">{m.instructions}</div>
                      )}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("step_reference")}</Label>
            <Input
              placeholder={t("ref_placeholder")}
              value={txRef}
              onChange={(e) => setTxRef(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("step_screenshot")}</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>

          <div className="space-y-2">
            <Label>{t("note_optional")}</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("note_placeholder")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={submitting || methods.length === 0}>
            {submitting ? t("sending") : t("submit_request")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
