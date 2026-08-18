import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { buildSession, countSessionCandidates } from "@/lib/sessions.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";
import {
  LaunchBar,
  ModeCard,
  SessionPill,
  SessionSection,
  SessionTopBar,
  TypeChip,
} from "@/components/session/SessionShell";

export const Route = createFileRoute("/_authenticated/questions/new")({
  head: () => ({
    meta: [
      { title: "Nouvelle session — Med Apex" },
      { name: "description", content: "Composez une session de QCM à partir de vos modules, cours et filtres." },
      { property: "og:title", content: "Nouvelle session — Med Apex" },
      { property: "og:description", content: "Composez une session de QCM à partir de vos modules, cours et filtres." },
    ],
  }),
  component: () => <AnyScopeGate scope="sessions"><NewSessionPage /></AnyScopeGate>,
});

type Mod = { id: string; title: string; year: number };
type Folder = { id: string; module_id: string; name: string };
type QMeta = { module_id: string; exam_year: number | null; exam_source: string | null };
type QType = "qcm" | "qcs" | "qroc" | "cas_clinique";

const TYPE_LABEL: Record<QType, string> = {
  qcm: "QCM",
  qcs: "QCS",
  qroc: "Questions ouvertes",
  cas_clinique: "Cas cliniques",
};

function NewSessionPage() {
  const { t, tr } = useI18n();
  const navigate = useNavigate();
  const countFn = useServerFn(countSessionCandidates);
  const buildFn = useServerFn(buildSession);

  const [mods, setMods] = useState<Mod[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [meta, setMeta] = useState<QMeta[]>([]);
  const [poolCounts, setPoolCounts] = useState<Record<string, number>>({});
  const [poolTotal, setPoolTotal] = useState(0);

  const [selMods, setSelMods] = useState<string[]>([]);
  const [selFolders, setSelFolders] = useState<string[]>([]);
  const [selYears, setSelYears] = useState<number[]>([]);
  const [modQuery, setModQuery] = useState("");
  const [folderQuery, setFolderQuery] = useState("");

  const [types, setTypes] = useState<QType[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [yearMin, setYearMin] = useState<string>("__all");
  const [yearMax, setYearMax] = useState<string>("__all");
  const [unseen, setUnseen] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [due, setDue] = useState(false);
  const [flagged, setFlagged] = useState(false);

  const [mode, setMode] = useState<"training" | "exam">("training");
  const [shuffleOn, setShuffleOn] = useState(false);
  const [limit, setLimit] = useState(20);
  const [counts, setCounts] = useState<{ total: number; byType: Record<string, number> } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data }, all] = await Promise.all([
        supabase.from("modules").select("id,title,year").order("year").order("title"),
        fetchAllRows<{ module_id: string }>(() => supabase.from("questions").select("module_id").is("parent_id", null)).catch(() => []),
      ]);
      setMods((data as Mod[]) ?? []);
      const map: Record<string, number> = {};
      for (const r of ((all as { module_id: string }[]) ?? [])) map[r.module_id] = (map[r.module_id] ?? 0) + 1;
      setPoolCounts(map);
      setPoolTotal(((all as unknown[]) ?? []).length);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (selMods.length === 0) { setFolders([]); setMeta([]); return; }
      const [{ data: f }, q] = await Promise.all([
        supabase.from("module_folders").select("id,module_id,name").in("module_id", selMods).order("name"),
        fetchAllRows<QMeta>(() => supabase.from("questions").select("module_id,exam_year,exam_source").in("module_id", selMods).is("parent_id", null)).catch(() => [] as QMeta[]),
      ]);
      setFolders((f as Folder[]) ?? []);
      setMeta(q ?? []);
      setSelFolders((prev) => prev.filter((id) => ((f as Folder[]) ?? []).some((x) => x.id === id)));
    })();
  }, [selMods]);

  const filters = useMemo(() => ({
    moduleIds: selMods,
    folderIds: selFolders,
    rotationIds: [] as string[],
    types,
    sources,
    yearMin: yearMin === "__all" ? null : Number(yearMin),
    yearMax: yearMax === "__all" ? null : Number(yearMax),
    unseen, wrong, commented: false, noted: false, due, flagged,
  }), [selMods, selFolders, types, sources, yearMin, yearMax, unseen, wrong, due, flagged]);

  useEffect(() => {
    if (selMods.length === 0) { setCounts(null); return; }
    let cancel = false;
    const id = setTimeout(async () => {
      try {
        const res = await countFn({ data: filters as any });
        if (!cancel) setCounts(res as any);
      } catch { /* ignore transient */ }
    }, 250);
    return () => { cancel = true; clearTimeout(id); };
  }, [filters, selMods.length, countFn]);

  const total = counts?.total ?? 0;
  useEffect(() => { setLimit((l) => (total > 0 ? Math.min(l, total) : l)); }, [total]);

  const byYear = useMemo(() => {
    const q = modQuery.trim().toLowerCase();
    const list = q ? mods.filter((m) => m.title.toLowerCase().includes(q)) : mods;
    return list.reduce<Record<number, Mod[]>>((acc, m) => { (acc[m.year] ||= []).push(m); return acc; }, {});
  }, [mods, modQuery]);

  const visibleFolders = useMemo(() => {
    const q = folderQuery.trim().toLowerCase();
    return q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders;
  }, [folders, folderQuery]);

  const examYears = useMemo(() => {
    const s = new Set<number>();
    for (const m of meta) if (m.exam_year != null) s.add(m.exam_year);
    return Array.from(s).sort((a, b) => b - a);
  }, [meta]);

  const examSources = useMemo(() => {
    const s = new Set<string>();
    for (const m of meta) if (m.exam_source) s.add(m.exam_source);
    return Array.from(s).sort();
  }, [meta]);

  /** Modules of the selected study year(s) — the pool step 2 works from. */
  const yearMods = useMemo(
    () => (selYears.length === 0 ? [] : mods.filter((m) => selYears.includes(m.year))),
    [mods, selYears],
  );

  const visibleMods = useMemo(() => {
    const q = modQuery.trim().toLowerCase();
    return q ? yearMods.filter((m) => m.title.toLowerCase().includes(q)) : yearMods;
  }, [yearMods, modQuery]);

  /** Distinct study years with their module counts. */
  const studyYears = useMemo(() => {
    const map = new Map<number, number>();
    for (const m of mods) map.set(m.year, (map.get(m.year) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [mods]);

  // Drop selected modules that no longer belong to a selected year.
  useEffect(() => {
    setSelMods((prev) => {
      const allowed = new Set(yearMods.map((m) => m.id));
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [yearMods]);

  const folderModule = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of mods) map[m.id] = m.title;
    return map;
  }, [mods]);

  const toggle = (arr: string[], set: (v: string[]) => void, id: string) =>
    set(arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

  const autoTitleValue = useMemo(() => {
    const first = mods.find((m) => m.id === selMods[0]);
    const base = selMods.length > 1 ? `${first?.title ?? tr("Session")} +${selMods.length - 1}` : first?.title ?? tr("Session");
    return `${base} ${new Date().toLocaleString()}`;
  }, [mods, selMods]);

  const create = async () => {
    if (selMods.length === 0) { toast.error(tr("Sélectionnez au moins un module")); return; }
    setBusy(true);
    try {
      const res: any = await buildFn({ data: {
        filters: filters as any,
        title: autoTitleValue,
        limit: Math.max(1, limit),
        sortMode: shuffleOn ? "random" : "year_desc",
        mode,
      } as any });
      navigate({ to: "/modules/$moduleId/qcm/$sessionId", params: { moduleId: res.moduleId, sessionId: res.sessionId } });
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally { setBusy(false); }
  };

  return (
    <div className="min-h-screen bg-background">
      <SessionTopBar
        backTo="/questions"
        title={tr("Générateur d'examen global")}
        subtitle={t("q_hub_title")}
        right={<SessionPill pulse>{poolTotal.toLocaleString("fr-FR")} {tr("questions")}</SessionPill>}
      />

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-32">
        {/* 1. Année d'étude */}
        <SessionSection
          step={1}
          title={tr("Sélectionner l'année d'étude")}
          actions={
            <button
              type="button"
              className="text-xs font-medium text-primary hover:underline"
              onClick={() => setSelYears(selYears.length === studyYears.length ? [] : studyYears.map(([y]) => y))}
            >
              {selYears.length === studyYears.length && studyYears.length > 0 ? tr("Tout désélectionner") : tr("Toutes les années")}
            </button>
          }
        >
          <div className="flex flex-wrap gap-2">
            {studyYears.map(([y, count]) => {
              const active = selYears.includes(y);
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setSelYears(active ? selYears.filter((v) => v !== y) : [...selYears, y])}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-medium transition ${
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-background/60 text-foreground hover:border-foreground/20"
                  }`}
                >
                  {y}{tr("ème année")}
                  <span className="ml-2 text-xs text-muted-foreground">{count} {count > 1 ? tr("modules") : tr("module")}</span>
                </button>
              );
            })}
            {studyYears.length === 0 && <p className="py-2 text-sm text-muted-foreground">{tr("Aucune année accessible.")}</p>}
          </div>
        </SessionSection>

        {/* 2. Modules */}
        <SessionSection
          step={2}
          title={tr("Sélectionner les modules")}
          actions={
            <button
              type="button"
              disabled={yearMods.length === 0}
              className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
              onClick={() => setSelMods(selMods.length === yearMods.length ? [] : yearMods.map((m) => m.id))}
            >
              {selMods.length === yearMods.length && yearMods.length > 0 ? tr("Tout désélectionner") : tr("Tout sélectionner")}
            </button>
          }
        >
          <Input
            className="rounded-xl"
            placeholder={tr("Filtrer les modules (ex. Cardiologie, Neurologie)…")}
            value={modQuery}
            onChange={(e) => setModQuery(e.target.value)}
            disabled={selYears.length === 0}
          />
          <div className="grid max-h-56 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
            {visibleMods.map((m) => (
              <label
                key={m.id}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border bg-background/60 p-3 transition hover:border-foreground/20"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Checkbox checked={selMods.includes(m.id)} onCheckedChange={() => toggle(selMods, setSelMods, m.id)} />
                  <span className="truncate text-sm font-medium">{m.title} <span className="text-muted-foreground">({m.year}{tr("ème année")})</span></span>
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{poolCounts[m.id] ?? 0} {tr("q")}</span>
              </label>
            ))}
            {visibleMods.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {selYears.length === 0 ? tr("Choisissez d'abord une année d'étude.") : tr("Aucun module accessible.")}
              </p>
            )}
          </div>
        </SessionSection>

        {/* 3. Cours */}
        <SessionSection
          step={3}
          title={tr("Sélectionner les cours (Cours / TD)")}
          actions={
            <div className="flex items-center gap-2">
              <button type="button" disabled={folders.length === 0} className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                onClick={() => setSelFolders(folders.map((f) => f.id))}>{tr("Tout sélectionner")}</button>
              <span className="text-muted-foreground/50">|</span>
              <button type="button" disabled={selFolders.length === 0} className="text-xs font-medium text-muted-foreground hover:underline disabled:opacity-40"
                onClick={() => setSelFolders([])}>{tr("Effacer")}</button>
            </div>
          }
        >
          <Input
            className="rounded-xl"
            placeholder={tr("Rechercher un cours dans les modules sélectionnés…")}
            value={folderQuery}
            onChange={(e) => setFolderQuery(e.target.value)}
          />
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {visibleFolders.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background/60 p-3 transition hover:border-foreground/20">
                <Checkbox checked={selFolders.includes(f.id)} onCheckedChange={() => toggle(selFolders, setSelFolders, f.id)} />
                <span className="text-sm font-medium">
                  {f.name}
                  <span className="ml-1 text-xs font-normal text-muted-foreground">({folderModule[f.module_id] ?? "—"})</span>
                </span>
              </label>
            ))}
            {folders.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                {tr("Sélectionnez un module pour voir ses cours. Sans sélection, tous les cours sont inclus.")}
              </p>
            )}
          </div>
        </SessionSection>

        {/* 4. Types & meta */}
        <SessionSection step={4} title={tr("Types de questions & données d'examen")}>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground">{tr("Formats autorisés")}</label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(Object.keys(TYPE_LABEL) as QType[]).map((ty) => (
                <TypeChip key={ty} label={TYPE_LABEL[ty]} active={types.includes(ty)} onClick={() => toggle(types, setTypes as any, ty)} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{tr("Années d'examen")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={yearMin} onValueChange={setYearMin}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder={tr("≥")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">≥ —</SelectItem>
                    {examYears.map((y) => <SelectItem key={y} value={String(y)}>≥ {y}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={yearMax} onValueChange={setYearMax}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder={tr("≤")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">≤ —</SelectItem>
                    {examYears.map((y) => <SelectItem key={y} value={String(y)}>≤ {y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{tr("Source d'examen")}</label>
              <Select value={sources[0] ?? "__all"} onValueChange={(v) => setSources(v === "__all" ? [] : [v])}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{tr("Toutes les sources")}</SelectItem>
                  {examSources.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{tr("Nombre de questions visé")}</label>
              <Input
                className="rounded-xl"
                type="number"
                min={1}
                value={limit}
                onChange={(e) => setLimit(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
        </SessionSection>

        {/* 5. Protocole */}
        <SessionSection step={5} title={tr("Protocole de simulation")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModeCard
              title={tr("Mode entraînement")}
              description={tr("Correction et explications affichées immédiatement.")}
              active={mode === "training"}
              onClick={() => setMode("training")}
            />
            <ModeCard
              title={tr("Simulation d'examen")}
              description={tr("Chronomètre strict, évaluation à la fin de la session.")}
              active={mode === "exam"}
              onClick={() => setMode("exam")}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
            <Checkbox checked={shuffleOn} onCheckedChange={(v) => setShuffleOn(!!v)} />
            {tr("Mélanger l'ordre des questions")}
          </label>
        </SessionSection>
      </main>

      <LaunchBar
        caption={tr("Pool de questions filtré")}
        headline={`${total} ${total > 1 ? tr("questions prêtes") : tr("question prête")}`}
        actionLabel={tr("Lancer la session")}
        onAction={create}
        busy={busy}
        disabled={busy || total === 0}
      />
    </div>
  );
}
