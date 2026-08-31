import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Play,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { useConfirm } from "@/hooks/use-confirm";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/history")({
  head: () => ({
    meta: [
      { title: "Historique des sessions — Med Apex" },
      { name: "description", content: "Retrouvez vos sessions de QCM classées par module." },
      { property: "og:title", content: "Historique des sessions — Med Apex" },
      { property: "og:description", content: "Retrouvez vos sessions de QCM classées par module." },
    ],
  }),
  component: () => (
    <AnyScopeGate scope="sessions">
      <HistoryPage />
    </AnyScopeGate>
  ),
});

type Row = {
  id: string;
  module_id: string;
  module_ids: string[] | null;
  title: string | null;
  question_ids: string[] | null;
  answers: Record<string, unknown> | null;
  grades: Record<string, unknown> | null;
  started_at: string;
  finished_at: string | null;
  score: number | null;
  total: number;
  mode: string | null;
  duration_seconds: number | null;
};
type Mod = { id: string; title: string; year: number | null };

function HistoryPage() {
  const { t, tr } = useI18n();
  const confirm = useConfirm();
  const [rows, setRows] = useState<Row[]>([]);
  const [mods, setMods] = useState<Record<string, string>>({});
  const [modYear, setModYear] = useState<Record<string, number | null>>({});
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openYear, setOpenYear] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase
        .from("qcm_sessions")
        .select(
          "id,module_id,module_ids,title,question_ids,answers,grades,started_at,finished_at,score,total,mode,duration_seconds",
        )
        .eq("user_id", u.user.id)
        .order("started_at", { ascending: false })
        .limit(200);
      const list = (data as Row[]) ?? [];
      setRows(list);
      const ids = Array.from(
        new Set(list.flatMap((r) => [r.module_id, ...(r.module_ids ?? [])]).filter(Boolean)),
      );
      if (ids.length > 0) {
        const { data: m } = await supabase.from("modules").select("id,title,year").in("id", ids);
        const map: Record<string, string> = {};
        const ymap: Record<string, number | null> = {};
        for (const x of (m as Mod[]) ?? []) {
          map[x.id] = x.title;
          ymap[x.id] = x.year ?? null;
        }
        setMods(map);
        setModYear(ymap);
      }
    })();
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const keys = Array.from(new Set([r.module_id, ...(r.module_ids ?? [])].filter(Boolean)));
      const label = (r.title ?? "").toLowerCase();
      for (const k of keys) {
        const modTitle = (mods[k] ?? "").toLowerCase();
        if (q && !modTitle.includes(q) && !label.includes(q)) continue;
        const arr = map.get(k) ?? [];
        arr.push(r);
        map.set(k, arr);
      }
    }
    return Array.from(map.entries()).sort((a, b) =>
      (mods[a[0]] ?? "").localeCompare(mods[b[0]] ?? ""),
    );
  }, [rows, mods, query]);

  const deleteSession = async (id: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      !(await confirm(tr("Supprimer cette session ? Cette action est irréversible."), {
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase.from("qcm_sessions").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success(tr("Session supprimée"));
  };

  const years = useMemo(() => {
    const map = new Map<string, [string, Row[]][]>();
    for (const entry of groups) {
      const y = modYear[entry[0]];
      const key = y != null ? String(y) : "autre";
      const arr = map.get(key) ?? [];
      arr.push(entry);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => {
      if (a[0] === "autre") return 1;
      if (b[0] === "autre") return -1;
      return Number(a[0]) - Number(b[0]);
    });
  }, [groups, modYear]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/questions">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("q_hub_title")}
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">{t("history_title")}</h1>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={tr("Rechercher un module ou une session…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rows.length} {t("sessions_count")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groups.length === 0 && (
              <p className="text-sm text-muted-foreground">{t("no_session_yet")}</p>
            )}
            {years.map(([yearKey, entries]) => {
              const yOpen = openYear[yearKey] ?? true;
              const yCount = entries.reduce((n, e) => n + e[1].length, 0);
              return (
                <div key={yearKey} className="rounded-lg border bg-muted/30">
                  <button
                    onClick={() => setOpenYear((p) => ({ ...p, [yearKey]: !yOpen }))}
                    className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-accent"
                  >
                    <span className="flex items-center gap-2">
                      {yOpen ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <FolderOpen className="h-4 w-4 text-primary" />
                      {yearKey === "autre" ? tr("Autre") : `${yearKey}${tr("ᵉ année")}`}
                    </span>
                    <Badge variant="secondary">{yCount}</Badge>
                  </button>
                  {yOpen && (
                    <div className="space-y-3 border-t p-2">
                      {entries.map(([modId, list]) => {
                        const isOpen = open[modId] ?? true;
                        return (
                          <div key={modId} className="rounded-lg border">
                            <button
                              onClick={() => setOpen((p) => ({ ...p, [modId]: !isOpen }))}
                              className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent"
                            >
                              <span className="flex items-center gap-2">
                                {isOpen ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                                <FolderOpen className="h-4 w-4 text-primary" />
                                {mods[modId] ?? t("module")}
                              </span>
                              <Badge variant="secondary">{list.length}</Badge>
                            </button>
                            {isOpen && (
                              <div className="space-y-1 border-t p-2">
                                {list.map((s) => {
                                  const pct =
                                    s.total > 0 && s.score != null
                                      ? Math.round((Number(s.score) / s.total) * 100)
                                      : null;
                                  const multi = (s.module_ids ?? []).length > 1;
                                  const ids = s.question_ids ?? [];
                                  const answered = ids.filter((qid) => {
                                    const a = (s.answers ?? {})[qid];
                                    const g = (s.grades ?? {})[qid];
                                    if (g != null) return true;
                                    if (Array.isArray(a)) return a.length > 0;
                                    if (typeof a === "string") return a.trim().length > 0;
                                    return a != null;
                                  }).length;
                                  const done = s.finished_at != null;
                                  const progress =
                                    ids.length > 0 ? Math.round((answered / ids.length) * 100) : 0;
                                  const infoBlock = (
                                    <div>
                                      <div className="font-medium">
                                        {s.title ?? mods[s.module_id] ?? t("module")}
                                      </div>
                                      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-1.5">
                                        <span>{new Date(s.started_at).toLocaleString()}</span>
                                        {s.mode && (
                                          <Badge variant="outline" className="text-[10px]">
                                            {s.mode === "exam" ? t("exam") : t("training")}
                                          </Badge>
                                        )}
                                        {!done && (
                                          <Badge className="text-[10px]">{t("in_progress")}</Badge>
                                        )}
                                        {multi && (
                                          <Badge variant="outline" className="text-[10px]">
                                            {s.module_ids!.length} {tr("modules")}
                                          </Badge>
                                        )}
                                        {s.duration_seconds != null && (
                                          <span>
                                            · {Math.round(s.duration_seconds / 60)} {t("min")}
                                          </span>
                                        )}
                                      </div>
                                      {!done && ids.length > 0 && (
                                        <div className="mt-1.5 sm:hidden">
                                          <Progress value={progress} className="h-1.5 w-40" />
                                          <div className="mt-1 text-[10px] text-muted-foreground">
                                            {answered}/{ids.length} {tr("répondues")}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                  const progressBlock = !done && (
                                    <div className="hidden w-32 sm:block">
                                      <Progress value={progress} className="h-1.5" />
                                      <div className="mt-1 text-[10px] text-muted-foreground">
                                        {answered}/{ids.length} {tr("répondues")}
                                      </div>
                                    </div>
                                  );
                                  if (done) {
                                    return (
                                      <Link
                                        key={`${modId}-${s.id}`}
                                        to="/modules/$moduleId/qcm/$sessionId"
                                        params={{ moduleId: s.module_id, sessionId: s.id }}
                                        className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                                      >
                                        {infoBlock}
                                        <div className="flex items-center gap-3 text-right">
                                          <div>
                                            {s.score != null && (
                                              <>
                                                <div className="font-semibold">
                                                  {Math.round(Number(s.score) * 10) / 10}/{s.total}
                                                </div>
                                                {pct != null && (
                                                  <div className="text-xs text-muted-foreground">
                                                    {pct}%
                                                  </div>
                                                )}
                                              </>
                                            )}
                                          </div>
                                          <RotateCcw className="h-4 w-4 text-muted-foreground" />
                                          <button
                                            type="button"
                                            onClick={(e) => deleteSession(s.id, e)}
                                            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                            aria-label={tr("Supprimer")}
                                          >
                                            <Trash2 className="h-4 w-4" />
                                          </button>
                                        </div>
                                      </Link>
                                    );
                                  }
                                  return (
                                    <div
                                      key={`${modId}-${s.id}`}
                                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-accent"
                                    >
                                      <Link
                                        to="/modules/$moduleId/qcm/$sessionId"
                                        params={{ moduleId: s.module_id, sessionId: s.id }}
                                        className="min-w-0 flex-1"
                                      >
                                        {infoBlock}
                                      </Link>
                                      <div className="flex items-center gap-3 text-right">
                                        {progressBlock}
                                        <Link
                                          to="/modules/$moduleId/qcm/$sessionId"
                                          params={{ moduleId: s.module_id, sessionId: s.id }}
                                        >
                                          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20">
                                            <Play className="h-3.5 w-3.5" />
                                            {tr("Reprendre")}
                                          </span>
                                        </Link>
                                        <button
                                          type="button"
                                          onClick={(e) => deleteSession(s.id, e)}
                                          className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                          aria-label={tr("Supprimer")}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
