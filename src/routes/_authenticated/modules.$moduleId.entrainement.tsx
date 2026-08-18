import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { useServerFn } from "@tanstack/react-start";
import { listSourceIds } from "@/lib/sessions.functions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { ModuleScopeGate } from "@/lib/scopes";
import {
  LaunchBar,
  ModeCard,
  SessionPill,
  SessionSection,
  SessionTopBar,
  TypeChip,
} from "@/components/session/SessionShell";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/entrainement")({
  component: EntrainementGate,
});

function EntrainementGate() {
  const { moduleId } = Route.useParams();
  return <ModuleScopeGate moduleId={moduleId} scope="sessions"><QcmBuilder /></ModuleScopeGate>;
}

type Rotation = { id: string; label: string; sort_order: number };
type Folder = { id: string; name: string };
type QType = "qcm" | "qcs" | "qroc" | "cas_clinique";
type Source = "all" | "new" | "due" | "wrong" | "flagged";
type Question = { id: string; type: QType; rotation_id: string | null; folder_id: string | null; session_kind: string | null; session_number: number | null; session_title: string | null; parent_id: string | null; exam_year: number | null; exam_source: string | null };
type Session = { id: string; started_at: string; finished_at: string | null; score: number | null; total: number; session_kind: string | null; session_number: number | null; mode: string | null };

const TYPE_LABEL: Record<QType, string> = { qcm: "QCM", qcs: "QCS", qroc: "QROC", cas_clinique: "Clinical case" };

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function QcmBuilder() {
  const { t, tr, lang } = useI18n();
  const { moduleId } = Route.useParams();
  const navigate = useNavigate();
  const fetchSourceIds = useServerFn(listSourceIds);
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [moduleTitle, setModuleTitle] = useState<string>("");
  const [rotationId, setRotationId] = useState<string>("__all");
  const [sessionKind, setSessionKind] = useState<string>("__all");
  const [selFolders, setSelFolders] = useState<string[]>([]);
  const [folderQuery, setFolderQuery] = useState<string>("");
  const [yearMin, setYearMin] = useState<string>("__all");
  const [yearMax, setYearMax] = useState<string>("__all");
  const [examSource, setExamSource] = useState<string>("__all");
  const [source, setSource] = useState<Source>("all");
  const [mode, setMode] = useState<"training" | "exam">("training");
  const [timeLimit, setTimeLimit] = useState<string>("30");
  const [types, setTypes] = useState<Record<QType, boolean>>({ qcm: true, qcs: true, qroc: true, cas_clinique: true });
  const [maxQ, setMaxQ] = useState<string>("20");
  const [shuffleOn, setShuffleOn] = useState<boolean>(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: r }, { data: f }, q, { data: mo }] = await Promise.all([
        supabase.from("module_rotations").select("id,label,sort_order").eq("module_id", moduleId).order("sort_order"),
        supabase.from("module_folders").select("id,name").eq("module_id", moduleId).order("name"),
        fetchAllRows<Question>(() => supabase.from("questions").select("id,type,rotation_id,folder_id,session_kind,session_number,session_title,parent_id,exam_year,exam_source").eq("module_id", moduleId).is("parent_id", null)).catch(() => [] as Question[]),
        supabase.from("modules").select("title").eq("id", moduleId).maybeSingle(),
      ]);
      setRotations((r as Rotation[]) ?? []);
      setFolders((f as Folder[]) ?? []);
      setQuestions(q ?? []);
      setModuleTitle((mo as { title: string } | null)?.title ?? "");
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const { data: s } = await supabase.from("qcm_sessions").select("id,started_at,finished_at,score,total,session_kind,session_number,mode").eq("module_id", moduleId).eq("user_id", u.user.id).order("started_at", { ascending: false }).limit(20);
        setSessions((s as Session[]) ?? []);
      }
    })();
  }, [moduleId]);

  const examYears = useMemo(() => {
    const set = new Set<number>();
    for (const q of questions) if (q.exam_year != null) set.add(q.exam_year);
    return Array.from(set).sort((a, b) => b - a);
  }, [questions]);

  const filtered = useMemo(() => questions.filter((q) => {
    if (!types[q.type]) return false;
    if (rotationId !== "__all" && q.rotation_id !== rotationId) return false;
    if (sessionKind !== "__all" && q.session_kind !== sessionKind) return false;
    if (selFolders.length > 0 && (!q.folder_id || !selFolders.includes(q.folder_id))) return false;
    if (yearMin !== "__all" && (q.exam_year == null || q.exam_year < Number(yearMin))) return false;
    if (yearMax !== "__all" && (q.exam_year == null || q.exam_year > Number(yearMax))) return false;
    if (examSource !== "__all" && (q.exam_source ?? "") !== examSource) return false;
    return true;
  }), [questions, types, rotationId, sessionKind, selFolders, yearMin, yearMax, examSource]);

  const visibleFolders = useMemo(() => {
    const q = folderQuery.trim().toLowerCase();
    return q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders;
  }, [folders, folderQuery]);

  const toggleFolder = (id: string) =>
    setSelFolders((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleType = (t2: QType) => setTypes(prev => ({ ...prev, [t2]: !prev[t2] }));

  const start = async () => {
    if (filtered.length === 0) { toast.error(t("no_q_match")); return; }
    setBusy(true);
    try {
      let pool = filtered;
      if (source !== "all") {
        const { ids } = await fetchSourceIds({ data: { moduleId, source } });
        if (ids) {
          const set = new Set(ids);
          pool = pool.filter((q) => set.has(q.id));
        }
      }
      if (pool.length === 0) { toast.error(t("no_q_source")); return; }
      let picks = shuffleOn ? shuffle(pool) : pool;
      const limit = maxQ === "all" ? picks.length : Math.min(Number(maxQ), picks.length);
      picks = picks.slice(0, limit);
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { toast.error(t("session_expired")); return; }
      const { data, error } = await supabase.from("qcm_sessions").insert({
        user_id: u.user.id,
        module_id: moduleId,
        rotation_id: rotationId === "__all" ? null : rotationId,
        session_kind: sessionKind === "__all" ? null : sessionKind,
        session_number: null,
        types: (Object.keys(types) as QType[]).filter(x => types[x]),
        question_ids: picks.map(p => p.id),
        total: picks.length,
        mode,
        time_limit_seconds: mode === "exam" ? Math.max(60, Number(timeLimit) * 60) : null,
        filters: { source, yearMin, yearMax, examSource, rotationId, sessionKind, folderIds: selFolders, types } as any,
      }).select("id").single();
      if (error) throw error;
      navigate({ to: "/modules/$moduleId/qcm/$sessionId", params: { moduleId, sessionId: data.id } });
    } catch (e: any) {
      toast.error(e.message ?? t("error"));
    } finally { setBusy(false); }
  };

  const locale = lang === "en" ? "en-US" : "fr-FR";

  return (
    <div className="min-h-screen bg-background">
      <SessionTopBar
        backTo="/modules/$moduleId"
        backParams={{ moduleId }}
        title={moduleTitle || t("new_session")}
        subtitle={t("new_session_sub")}
        right={<SessionPill pulse>{questions.length} questions</SessionPill>}
      />

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-6 pb-32">
        {/* 1. Cours */}
        <SessionSection
          step={1}
          title={t("course_td")}
          actions={
            <div className="flex items-center gap-2">
              <button type="button" disabled={folders.length === 0} className="text-xs font-medium text-primary hover:underline disabled:opacity-40"
                onClick={() => setSelFolders(folders.map((f) => f.id))}>{t("select_all")}</button>
              <span className="text-muted-foreground/50">|</span>
              <button type="button" disabled={selFolders.length === 0} className="text-xs font-medium text-muted-foreground hover:underline disabled:opacity-40"
                onClick={() => setSelFolders([])}>{t("clear")}</button>
            </div>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t("rotation")}</label>
              <Select value={rotationId} onValueChange={setRotationId}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("all_f")}</SelectItem>
                  {rotations.map((r) => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{tr("Cours / TD")}</label>
              <Select value={sessionKind} onValueChange={setSessionKind}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("both")}</SelectItem>
                  <SelectItem value="cours">{t("course")}</SelectItem>
                  <SelectItem value="td">{tr("TD")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Input className="rounded-xl" placeholder={tr("Rechercher un cours…")} value={folderQuery} onChange={(e) => setFolderQuery(e.target.value)} />
          <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
            {visibleFolders.map((f) => (
              <label key={f.id} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-background/60 p-3 transition hover:border-foreground/20">
                <Checkbox checked={selFolders.includes(f.id)} onCheckedChange={() => toggleFolder(f.id)} />
                <span className="text-sm font-medium">{f.name}</span>
              </label>
            ))}
            {folders.length === 0 && <p className="py-4 text-sm text-muted-foreground">{tr("Aucun cours pour ce module.")}</p>}
            {folders.length > 0 && visibleFolders.length === 0 && <p className="py-4 text-sm text-muted-foreground">{tr("Aucun cours ne correspond.")}</p>}
          </div>
        </SessionSection>

        {/* 2. Types & meta */}
        <SessionSection step={2} title={t("question_types")}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(types) as QType[]).map((t2) => (
              <TypeChip key={t2} label={TYPE_LABEL[t2]} active={types[t2]} onClick={() => toggleType(t2)} />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t("exam_year")}</label>
              <div className="grid grid-cols-2 gap-2">
                <Select value={yearMin} onValueChange={setYearMin}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="≥" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">≥ —</SelectItem>
                    {examYears.map((y) => <SelectItem key={y} value={String(y)}>≥ {y}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={yearMax} onValueChange={setYearMax}>
                  <SelectTrigger className="rounded-xl"><SelectValue placeholder="≤" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all">≤ —</SelectItem>
                    {examYears.map((y) => <SelectItem key={y} value={String(y)}>≤ {y}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t("exam_source")}</label>
              <Select value={examSource} onValueChange={setExamSource}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">{t("all_f")}</SelectItem>
                  <SelectItem value="externat_p1">{tr("Externat P1")}</SelectItem>
                  <SelectItem value="externat_p2">{tr("Externat P2")}</SelectItem>
                  <SelectItem value="externat_p3">{tr("Externat P3")}</SelectItem>
                  <SelectItem value="residanat">{tr("Résidanat")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{t("question_count")}</label>
              <Select value={maxQ} onValueChange={setMaxQ}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["10", "20", "50", "all"].map((v) => <SelectItem key={v} value={v}>{v === "all" ? t("all_f") : v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </SessionSection>

        {/* 3. Protocole */}
        <SessionSection step={3} title={t("mode")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ModeCard title={t("training")} description={t("immediate_correction")} active={mode === "training"} onClick={() => setMode("training")} />
            <ModeCard title={t("exam")} description={t("timer_end_correction")} active={mode === "exam"} onClick={() => setMode("exam")} />
          </div>
          {mode === "exam" && (
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-muted-foreground">{t("duration_min")}</span>
              <Input type="number" min="1" className="w-28 rounded-xl" value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} />
            </div>
          )}
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm">
            <Checkbox checked={shuffleOn} onCheckedChange={(v) => setShuffleOn(!!v)} />
            {t("shuffle_order")}
          </label>
        </SessionSection>

        {/* Historique */}
        <SessionSection
          title={t("recent_history")}
          actions={<Link to="/questions/history" className="text-xs font-medium text-primary hover:underline">{t("view_all")}</Link>}
        >
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">{t("no_session_yet")}</p>}
          {sessions.map((s) => (
            <Link key={s.id} to="/modules/$moduleId/qcm/$sessionId" params={{ moduleId, sessionId: s.id }}
              className="flex items-center justify-between rounded-xl border bg-background/60 px-3 py-2 text-sm transition hover:border-foreground/20">
              <div>
                <div className="font-medium">{new Date(s.started_at).toLocaleString(locale)}</div>
                <div className="flex gap-1.5 text-xs text-muted-foreground">
                  {s.mode && <Badge variant="outline" className="text-[10px]">{s.mode === "exam" ? t("exam") : t("training")}</Badge>}
                  {s.session_kind && <Badge variant="outline" className="text-[10px]">{s.session_kind}{s.session_number ? " " + s.session_number : ""}</Badge>}
                  <span>{s.finished_at ? t("finished") : t("in_progress")}</span>
                </div>
              </div>
              <div className="text-right">
                {s.finished_at != null && s.score != null
                  ? <span className="font-semibold">{Math.round(Number(s.score) * 10) / 10}/{s.total}</span>
                  : <span className="text-muted-foreground">—/{s.total}</span>}
              </div>
            </Link>
          ))}
        </SessionSection>
      </main>

      <LaunchBar
        caption={t("q_available")}
        headline={`${filtered.length} question${filtered.length > 1 ? "s" : ""}`}
        actionLabel={t("start")}
        onAction={start}
        busy={busy}
        disabled={busy || filtered.length === 0}
      />
    </div>
  );
}
