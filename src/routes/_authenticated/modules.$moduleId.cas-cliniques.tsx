import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Stethoscope, Play } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { ModuleScopeGate, useModuleColor, moduleBackgroundStyle } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/cas-cliniques")({
  component: CasCliniquesGate,
});

function CasCliniquesGate() {
  const { moduleId } = Route.useParams();
  return (
    <ModuleScopeGate moduleId={moduleId} scope="sessions">
      <CasCliniquesPage />
    </ModuleScopeGate>
  );
}

type Module = { id: string; title: string; year: number };
type Case = { id: string; stem: string; sort_order: number | null; sub_count: number };

function CasCliniquesPage() {
  const { t } = useI18n();
  const { moduleId } = Route.useParams();
  const navigate = useNavigate();
  const [mod, setMod] = useState<Module | null>(null);
  const [cases, setCases] = useState<Case[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const moduleColor = useModuleColor();

  useEffect(() => {
    (async () => {
      const { data: m } = await supabase
        .from("modules")
        .select("id,title,year")
        .eq("id", moduleId)
        .maybeSingle();
      setMod(m as Module | null);
      const parents = await fetchAllRows<any>(() =>
        (supabase as any)
          .from("questions")
          .select("id,stem,sort_order")
          .eq("module_id", moduleId)
          .eq("type", "cas_clinique")
          .is("parent_id", null)
          .order("sort_order", { ascending: true, nullsFirst: false })
          .order("created_at", { ascending: true }),
      ).catch(() => [] as any[]);
      const parentIds = ((parents ?? []) as any[]).map((p) => p.id);
      let counts: Record<string, number> = {};
      if (parentIds.length > 0) {
        const subs = await fetchAllRows<any>(() =>
          (supabase as any).from("questions").select("parent_id").in("parent_id", parentIds),
        ).catch(() => [] as any[]);
        for (const r of (subs ?? []) as any[]) {
          counts[r.parent_id] = (counts[r.parent_id] ?? 0) + 1;
        }
      }
      setCases(((parents ?? []) as any[]).map((p) => ({ ...p, sub_count: counts[p.id] ?? 0 })));
    })();
  }, [moduleId]);

  const startCase = async (caseId: string, subCount: number) => {
    setBusy(caseId);
    try {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        toast.error(t("session_expired"));
        return;
      }
      const { data, error } = await (supabase as any)
        .from("qcm_sessions")
        .insert({
          user_id: u.user.id,
          module_id: moduleId,
          types: ["cas_clinique"],
          question_ids: [caseId],
          total: Math.max(1, subCount),
          mode: "training",
        })
        .select("id")
        .single();
      if (error) throw error;
      navigate({
        to: "/modules/$moduleId/qcm/$sessionId",
        params: { moduleId, sessionId: data.id },
      });
    } catch (e: any) {
      toast.error(e?.message ?? t("error"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen" style={moduleBackgroundStyle(moduleColor)}>
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/modules/$moduleId" params={{ moduleId }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("back_to_module")}
            </Link>
          </Button>
          {mod && (
            <Badge variant="secondary">
              {t("year")} {mod.year}
            </Badge>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Stethoscope className="h-7 w-7 text-primary" />
            {t("clinical_cases")}
          </h1>
          <p className="mt-2 text-muted-foreground">
            {mod?.title} · {t("clinical_cases_extra")}
          </p>
        </div>

        {cases.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("no_clinical_case")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {cases.map((c, i) => (
              <Card key={c.id} className="transition hover:shadow-md hover:border-primary/40">
                <CardHeader className="flex-row items-start gap-4 space-y-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-semibold">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base line-clamp-3 whitespace-pre-wrap">
                      {c.stem}
                    </CardTitle>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        {c.sub_count} {t("sub_questions")}
                      </Badge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={busy === c.id || c.sub_count === 0}
                    onClick={() => startCase(c.id, c.sub_count)}
                  >
                    <Play className="mr-1.5 h-4 w-4" />
                    {t("start_case")}
                  </Button>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
