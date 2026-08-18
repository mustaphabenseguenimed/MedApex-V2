import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { countFlashcards } from "@/lib/flashcards.functions";
import { getStats } from "@/lib/sessions.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, BookOpen, Flame, History, Layers, Plus, Target } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/")({
  head: () => ({
    meta: [
      { title: "Questions — Med Apex" },
      { name: "description", content: "Sessions, flashcards, stats and review." },
    ],
  }),
  component: () => <AnyScopeGate scope="sessions"><QuestionsHub /></AnyScopeGate>,
});

type Mod = { id: string; title: string; year: number };

function QuestionsHub() {
  const { t, tr } = useI18n();
  const loadCards = useServerFn(countFlashcards);
  const loadStats = useServerFn(getStats);
  const [cards, setCards] = useState<{ total: number; due: number } | null>(null);
  const [stats, setStats] = useState<{ dueToday: number; accuracy: number; totalAnswered: number } | null>(null);
  const [mods, setMods] = useState<Mod[]>([]);

  useEffect(() => {
    (async () => {
      const [c, s] = await Promise.all([loadCards(), loadStats()]);
      setCards(c as any);
      setStats(s as any);
      const { data } = await supabase.from("modules").select("id,title,year").order("year").order("title");
      setMods((data as Mod[]) ?? []);
    })();
  }, [loadCards, loadStats]);

  const byYear = mods.reduce<Record<number, Mod[]>>((acc, m) => {
    (acc[m.year] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" />{t("dashboard")}</Link>
          </Button>
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm"><Link to="/questions/history"><History className="mr-1.5 h-4 w-4" />{t("q_history")}</Link></Button>
            <Button asChild variant="ghost" size="sm"><Link to="/questions/stats"><Target className="mr-1.5 h-4 w-4" />{t("q_stats")}</Link></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{t("q_hub_title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("q_hub_sub")}</p>
        </div>

        <Button asChild size="lg">
          <Link to="/questions/new"><Plus className="mr-2 h-4 w-4" />{tr("Nouvelle session")}</Link>
        </Button>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Layers className="h-4 w-4 text-primary" />{t("flashcards")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{cards?.due ?? "—"} <span className="text-base font-normal text-muted-foreground">/ {cards?.total ?? 0}</span></div>
              <Button asChild size="sm" className="mt-2" disabled={!cards || cards.due === 0}>
                <Link to="/questions/flashcards">{t("review")}</Link>
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Flame className="h-4 w-4 text-primary" />{t("accuracy")}</CardTitle></CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold">{stats ? `${Math.round(stats.accuracy * 100)}%` : "—"}</div>
              <p className="text-xs text-muted-foreground">{stats?.totalAnswered ?? 0} {t("questions_seen")}</p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><BookOpen className="h-4 w-4" />{t("choose_module_practice")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {Object.keys(byYear).sort().map((y) => (
              <div key={y}>
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t("year")} {y}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {byYear[Number(y)].map((m) => (
                    <Link key={m.id} to="/modules/$moduleId/entrainement" params={{ moduleId: m.id }}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-accent transition">
                      {m.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
            {mods.length === 0 && <p className="text-sm text-muted-foreground">{t("no_module")}</p>}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
