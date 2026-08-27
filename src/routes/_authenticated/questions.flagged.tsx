import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Flag, Play, Search, X } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/flagged")({
  head: () => ({
    meta: [
      { title: "Questions marquées — Med Apex" },
      { name: "description", content: "Retrouvez les questions que vous avez marquées." },
    ],
  }),
  component: () => (
    <AnyScopeGate scope="sessions">
      <FlaggedQuestionsPage />
    </AnyScopeGate>
  ),
});

function stripHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type FlagRow = {
  id: string;
  question_id: string;
  created_at: string;
  questions: {
    id: string;
    stem: string;
    type: string;
    module_id: string;
  } | null;
};
type Mod = { id: string; title: string };

function FlaggedQuestionsPage() {
  const { t, tr } = useI18n();
  const [rows, setRows] = useState<FlagRow[]>([]);
  const [mods, setMods] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase
      .from("question_flags")
      .select("id, question_id, created_at, questions(id, stem, type, module_id)")
      .eq("user_id", u.user.id)
      .order("created_at", { ascending: false })
      .limit(300);
    const list = (data as unknown as FlagRow[]) ?? [];
    setRows(list);
    const modIds = Array.from(new Set(list.map((r) => r.questions?.module_id).filter(Boolean)));
    if (modIds.length > 0) {
      const { data: m } = await supabase
        .from("modules")
        .select("id,title")
        .in("id", modIds as string[]);
      const map: Record<string, string> = {};
      for (const x of (m as Mod[]) ?? []) map[x.id] = x.title;
      setMods(map);
    }
    setLoading(false);
  };

  useEffect(() => {
    load(); // eslint-disable-next-line
  }, []);

  const unflag = async (row: FlagRow) => {
    const { error } = await supabase.from("question_flags").delete().eq("id", row.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    toast.success(tr("Retiré des questions marquées"));
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        stripHtml(r.questions?.stem).toLowerCase().includes(q) ||
        (mods[r.questions?.module_id ?? ""] ?? "").toLowerCase().includes(q),
    );
  }, [rows, mods, query]);

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
        <h1 className="text-3xl font-semibold tracking-tight">{tr("Questions marquées")}</h1>
        <p className="text-sm text-muted-foreground -mt-2">
          {tr("Les questions que vous avez marquées avec le drapeau pendant vos sessions.")}
        </p>

        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder={tr("Rechercher…")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Flag className="h-4 w-4 text-primary" />
              {filtered.length} {tr("question(s) marquée(s)")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {!loading && filtered.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {tr("Aucune question marquée pour le moment.")}
              </p>
            )}
            {filtered.map((r) => {
              const q = r.questions;
              if (!q) return null;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{stripHtml(q.stem)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-[10px]">
                        {q.type.toUpperCase()}
                      </Badge>
                      {mods[q.module_id] && <span>{mods[q.module_id]}</span>}
                      <span>· {new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button asChild size="sm" variant="outline">
                      <Link to="/modules/$moduleId/entrainement" params={{ moduleId: q.module_id }}>
                        <Play className="mr-1.5 h-3.5 w-3.5" />
                        {tr("Réviser")}
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      title={tr("Retirer")}
                      onClick={() => unflag(r)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
