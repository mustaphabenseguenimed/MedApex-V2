import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStats } from "@/lib/sessions.functions";
import { countFlashcards } from "@/lib/flashcards.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Flame, Target, RefreshCw, Layers } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/stats")({
  component: () => <AnyScopeGate scope="sessions"><StatsPage /></AnyScopeGate>,
});

type Stats = { totalAnswered: number; dueToday: number; flagged: number; totalSessions: number; accuracy: number; perModule: Record<string, { score: number; total: number }> };

function StatsPage() {
  const { t } = useI18n();
  const load = useServerFn(getStats);
  const loadCards = useServerFn(countFlashcards);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mods, setMods] = useState<Record<string, string>>({});
  const [cards, setCards] = useState<{ total: number; due: number } | null>(null);

  useEffect(() => {
    (async () => {
      const s = (await load()) as Stats;
      setStats(s);
      setCards((await loadCards()) as any);
      const ids = Object.keys(s.perModule);
      if (ids.length > 0) {
        const { data: m } = await supabase.from("modules").select("id,title").in("id", ids);
        const map: Record<string, string> = {};
        for (const x of (m as any[]) ?? []) map[x.id] = x.title;
        setMods(map);
      }
    })();
  }, [load, loadCards]);

  const kpi = (Icon: any, label: string, value: string | number) => (
    <Card><CardContent className="py-5 flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div>
      <div><div className="text-2xl font-semibold">{value}</div><div className="text-xs text-muted-foreground">{label}</div></div>
    </CardContent></Card>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-5xl px-6 py-4">
        <Button asChild variant="ghost" size="sm"><Link to="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" />{t("dashboard")}</Link></Button>
      </div></header>
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-6">
        <h1 className="text-3xl font-semibold tracking-tight">{t("my_stats")}</h1>
        {!stats ? (
          <p className="text-muted-foreground">…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              {kpi(Target, t("global_accuracy"), `${Math.round(stats.accuracy * 100)}%`)}
              {kpi(Flame, t("seen_questions"), stats.totalAnswered)}
              {kpi(RefreshCw, t("to_review_today"), stats.dueToday)}
              {kpi(Layers, t("due_flashcards"), cards ? `${cards.due}/${cards.total}` : "—")}
            </div>
            <p className="text-xs text-muted-foreground">{stats.flagged} {t("flagged_q")}</p>

            <Card>
              <CardHeader><CardTitle className="text-base">{t("per_module_perf")}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {Object.keys(stats.perModule).length === 0 && <p className="text-sm text-muted-foreground">{t("complete_sessions_stats")}</p>}
                {Object.entries(stats.perModule)
                  .map(([mid, v]) => ({ mid, pct: v.total > 0 ? v.score / v.total : 0, ...v }))
                  .sort((a, b) => a.pct - b.pct)
                  .map((row) => (
                    <div key={row.mid} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{mods[row.mid] ?? t("module")}</span>
                        <span className="text-muted-foreground">{Math.round(row.pct * 100)}% · {Math.round(row.score * 10) / 10}/{row.total}</span>
                      </div>
                      <div className="h-2 rounded bg-muted overflow-hidden">
                        <div className={`h-full ${row.pct < 0.5 ? "bg-red-500" : row.pct < 0.75 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.round(row.pct * 100)}%` }} />
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
