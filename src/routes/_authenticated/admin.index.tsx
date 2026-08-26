import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAll";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { MultiSearchableSelect } from "@/components/ui/multi-searchable-select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Upload,
  Pencil,
  FileText,
  X,
  ArrowUp,
  ArrowDown,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  Tag,
  KeyRound,
  Wallet,
  ShieldCheck,
  ScrollText,
  AlertTriangle,
  CalendarClock,
} from "lucide-react";
import { ImagePlus, Sparkles, ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import { useIsAdmin } from "@/hooks/use-admin";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useServerFn } from "@tanstack/react-start";
import {
  extractQuestionsFromImage,
  prepareDocxChunks,
  prepareTextChunks,
  extractQuestionsFromHtmlChunk,
  extractQuestionsFromPdfChunk,
  testGoogleAi,
  type ExtractedQ,
} from "@/lib/questions.functions";
import { parseQuestionsJson } from "@/lib/structuredImport";
import { extractLessonsFromProgram } from "@/lib/program.functions";
import { matchRotations, matchFolder, parseYears } from "@/lib/importMatch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { RichText } from "@/components/RichText";
import { BundleImport } from "@/components/admin/BundleImport";
import { CaseForm } from "@/components/admin/CaseForm";
import { useI18n } from "@/lib/i18n";
import { useConfirm, usePromptDialog } from "@/hooks/use-confirm";

export const Route = createFileRoute("/_authenticated/admin/")({
  head: () => ({ meta: [{ title: "Admin — Portail de Révision" }] }),
  component: AdminPage,
});

type Module = {
  id: string;
  year: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
};
type Kind = "html" | "pdf" | "richtext" | "link";
type Content = {
  id: string;
  module_id: string;
  kind: Kind;
  title: string;
  description: string | null;
  body: string | null;
  file_path: string | null;
  sort_order: number;
  created_by: string | null;
  folder_id: string | null;
};
type Folder = {
  id: string;
  module_id: string;
  kind: Kind;
  name: string;
  sort_order: number;
  created_by: string | null;
};
type Rotation = {
  id: string;
  module_id: string;
  label: string;
  sort_order: number;
  created_by: string | null;
};

const KIND_LABEL: Record<Kind, string> = {
  html: "Fiches HTML",
  pdf: "PDF",
  richtext: "Notes",
  link: "Lien URL",
};

// Option builders shared by admin question forms.
function rotationOptions(
  tr: (s: string) => string,
  rotations: Rotation[],
  noneLabel = "— aucune rotation —",
): SearchableOption[] {
  return [
    { value: "__none", label: tr(noneLabel) },
    ...rotations.map((r) => ({ value: r.id, label: r.label })),
  ];
}
function folderOptions(
  tr: (s: string) => string,
  folders: Folder[],
  noneLabel = "— aucun cours —",
): SearchableOption[] {
  return [
    { value: "__none", label: tr(noneLabel) },
    ...folders.map((f) => ({ value: f.id, label: f.name, hint: tr(KIND_LABEL[f.kind]) })),
  ];
}
function yearOptions(tr: (s: string) => string, anchorYear?: number | null): SearchableOption[] {
  const now = new Date().getFullYear();
  const set = new Set<number>();
  for (let y = now - 8; y <= now + 1; y++) set.add(y);
  if (anchorYear && Number.isFinite(anchorYear)) set.add(anchorYear);
  const arr = [...set].sort((a, b) => b - a);
  return [
    { value: "__none", label: tr("Non spécifiée") },
    ...arr.map((y) => ({ value: String(y), label: String(y) })),
  ];
}
/** Same list, without the "none" entry (multi-select clears by deselecting). */
function yearMultiOptions(
  tr: (s: string) => string,
  anchorYear?: number | null,
): SearchableOption[] {
  return yearOptions(tr, anchorYear).filter((o) => o.value !== "__none");
}
/** Rotations for a multi-select (clearing happens by deselecting everything). */
function rotationMultiOptions(rotations: Rotation[]): SearchableOption[] {
  return rotations.map((r) => ({ value: r.id, label: r.label }));
}
/** The displayed rotation is the last one in the module's rotation order. */
function primaryRotation(ids: string[] | null | undefined, rotations: Rotation[]): string | null {
  const set = new Set(ids ?? []);
  let last: string | null = null;
  for (const r of rotations) if (set.has(r.id)) last = r.id;
  return last ?? (ids && ids.length ? ids[ids.length - 1] : null);
}
/** The displayed year is always the most recent one assigned. */
function latestYear(years: (string | number)[] | null | undefined): number | null {
  const nums = (years ?? []).map(Number).filter((n) => Number.isFinite(n));
  return nums.length ? Math.max(...nums) : null;
}

function AdminPage() {
  const { tr } = useI18n();
  const isAdmin = useIsAdmin();
  const [checking, setChecking] = useState(true);
  const [anyAdmin, setAnyAdmin] = useState(true);

  useEffect(() => {
    if (isAdmin === null) return;
    if (isAdmin) {
      setChecking(false);
      return;
    }
    (async () => {
      const { count } = await supabase
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      setAnyAdmin((count ?? 0) > 0);
      setChecking(false);
    })();
  }, [isAdmin]);

  const claim = async () => {
    const { data, error } = await supabase.rpc("claim_admin");
    if (error) {
      toast.error(error.message);
      return;
    }
    if (data) {
      toast.success(tr("Vous êtes admin"));
      window.location.reload();
    } else toast.error(tr("Un admin existe déjà"));
  };

  if (checking || isAdmin === null)
    return <div className="p-10 text-center text-muted-foreground">…</div>;

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle>{tr("Accès admin requis")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {anyAdmin ? (
              <p className="text-sm text-muted-foreground">
                {tr("Cette section est réservée aux administrateurs.")}
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {tr("Aucun admin n'existe encore. Vous pouvez réclamer ce rôle.")}
                </p>
                <Button onClick={claim}>{tr("Devenir admin")}</Button>
              </>
            )}
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {tr("Retour")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AdminConsole />;
}

function AdminConsole() {
  const { tr } = useI18n();
  const { isSuper, has } = useAdminPermissions();
  const [modules, setModules] = useState<Module[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [contents, setContents] = useState<Content[]>([]);

  const loadModules = async () => {
    const { data } = await supabase.from("modules").select("*").order("year").order("sort_order");
    setModules((data as Module[]) ?? []);
  };
  const loadContents = async (mid: string) => {
    const { data } = await supabase
      .from("module_contents")
      .select("id,module_id,kind,title,description,body,file_path,sort_order,created_by,folder_id")
      .eq("module_id", mid)
      .in("kind", ["html", "pdf", "richtext"])
      .order("sort_order")
      .order("created_at");
    setContents((data as Content[]) ?? []);
  };
  useEffect(() => {
    loadModules();
  }, []);
  useEffect(() => {
    if (selected) loadContents(selected);
    else setContents([]);
  }, [selected]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Dashboard")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{tr("Administration")}</h1>
          <div className="flex gap-2">
            {(isSuper || has("manage_pricing")) && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/pricing">
                  <Tag className="mr-1.5 h-4 w-4" />
                  {tr("Tarifs")}
                </Link>
              </Button>
            )}
            {(isSuper || has("manage_access")) && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/access">
                  <KeyRound className="mr-1.5 h-4 w-4" />
                  {tr("Accès")}
                </Link>
              </Button>
            )}
            {(isSuper || has("manage_payments")) && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/payments">
                  <Wallet className="mr-1.5 h-4 w-4" />
                  {tr("Paiements")}
                </Link>
              </Button>
            )}
            {isSuper && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/admins">
                  <ShieldCheck className="mr-1.5 h-4 w-4" />
                  {tr("Admins")}
                </Link>
              </Button>
            )}
            {isSuper && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/audit">
                  <ScrollText className="mr-1.5 h-4 w-4" />
                  {tr("Audit")}
                </Link>
              </Button>
            )}
            {(isSuper || has("manage_quiz")) && (
              <Button asChild variant="outline" size="sm">
                <Link to="/admin/reports">
                  <AlertTriangle className="mr-1.5 h-4 w-4" />
                  {tr("Signalements")}
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl xl:max-w-7xl px-4 sm:px-6 py-8 grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
        <section className="min-w-0 space-y-4">
          <NewModuleForm onCreated={loadModules} />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{tr("Modules")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {modules.length === 0 && (
                <p className="text-sm text-muted-foreground">{tr("Aucun module.")}</p>
              )}
              {modules.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelected(m.id)}
                  className={`w-full flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-accent ${selected === m.id ? "border-primary bg-accent" : ""}`}
                >
                  <div>
                    <div className="font-medium">{m.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {tr("Année")} {m.year} · /{m.slug}
                    </div>
                  </div>
                  <Badge variant="outline">Y{m.year}</Badge>
                </button>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="min-w-0">
          {selected ? (
            <ModuleEditor
              module={modules.find((m) => m.id === selected)!}
              contents={contents}
              onModuleChanged={async () => {
                await loadModules();
              }}
              onModuleDeleted={async () => {
                setSelected(null);
                await loadModules();
              }}
              onContentsChanged={() => loadContents(selected)}
            />
          ) : (
            <Card>
              <CardContent className="py-16 text-center text-muted-foreground">
                {tr("Sélectionnez un module ou créez-en un.")}
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}

type QType = "qcm" | "qcs" | "qroc" | "cas_clinique";
type QPolarity = "correct" | "incorrect";
type Question = {
  id: string;
  module_id: string;
  year: number;
  rotation_id: string | null;
  folder_id: string | null;
  session_kind: string | null;
  session_number: number | null;
  session_title: string | null;
  type: QType;
  polarity: QPolarity;
  stem: string;
  choices: any;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  parent_id: string | null;
  sort_order: number;
  created_by: string | null;
  exam_year: number | null;
  exam_years: number[] | null;
  rotation_ids: string[] | null;
};

const QTYPE_LABEL: Record<QType, string> = {
  qcm: "QCM (multi)",
  qcs: "QCS (unique)",
  qroc: "QROC (ouverte)",
  cas_clinique: "Cas clinique",
};

function QuestionsPanel({
  moduleId,
  year,
  rotations,
  folders,
  canManage,
  isSuper,
  uid,
}: {
  moduleId: string;
  year: number;
  rotations: Rotation[];
  folders: Folder[];
  canManage: boolean;
  isSuper: boolean;
  uid: string | null;
}) {
  const { tr } = useI18n();
  const [items, setItems] = useState<Question[]>([]);
  const [open, setOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkRotationIds, setBulkRotationIds] = useState<string[]>([]);
  const [bulkYearValues, setBulkYearValues] = useState<string[]>([]);
  const load = async () => {
    const data = await fetchAllRows<Question>(() =>
      (supabase as any)
        .from("questions")
        .select("*")
        .eq("module_id", moduleId)
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true }),
    ).catch(() => [] as Question[]);
    setItems(data);
    setSelected(new Set());
  };
  useEffect(() => {
    load();
  }, [moduleId]);

  const remove = async (q: Question) => {
    const { error } = await (supabase as any).from("questions").delete().eq("id", q.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Supprimée");
      load();
    }
  };

  const [groupBy, setGroupBy] = useState<"none" | "folder" | "rotation" | "year">("none");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? window.localStorage.getItem("admin_q_group_by") : null;
    if (saved === "none" || saved === "folder" || saved === "rotation" || saved === "year")
      setGroupBy(saved);
  }, []);
  const changeGroupBy = (v: "none" | "folder" | "rotation" | "year") => {
    setGroupBy(v);
    if (typeof window !== "undefined") window.localStorage.setItem("admin_q_group_by", v);
  };

  const parents = items.filter((q) => !q.parent_id);
  const allSelected = parents.length > 0 && parents.every((q) => selected.has(q.id));
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(parents.map((q) => q.id)));

  const bulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await (supabase as any).from("questions").delete().in("id", ids);
    setBulkBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${ids.length} question(s) supprimée(s)`);
      load();
    }
  };

  const bulkAssign = async (
    patch: Partial<
      Pick<
        Question,
        | "rotation_id"
        | "rotation_ids"
        | "folder_id"
        | "session_kind"
        | "session_number"
        | "session_title"
        | "exam_year"
        | "exam_years"
      >
    >,
  ) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    const ids = [...selected];
    const { error } = await (supabase as any).from("questions").update(patch).in("id", ids);
    setBulkBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${ids.length} question(s) modifiée(s)`);
      load();
    }
  };

  const reindexIfNeeded = async () => {
    // ensure every parent question has a distinct sort_order for stable reordering
    const need = parents.some(
      (q, i, arr) => q.sort_order == null || (i > 0 && q.sort_order <= arr[i - 1].sort_order),
    );
    if (!need) return parents;
    const updates = parents.map((q, i) => ({ id: q.id, so: (i + 1) * 10 }));
    await Promise.all(
      updates.map((u) =>
        (supabase as any).from("questions").update({ sort_order: u.so }).eq("id", u.id),
      ),
    );
    return parents.map((q, i) => ({ ...q, sort_order: (i + 1) * 10 }));
  };

  const move = async (q: Question, dir: -1 | 1) => {
    const list = await reindexIfNeeded();
    const idx = list.findIndex((x) => x.id === q.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const a = list[idx],
      b = list[target];
    const { error } = await (supabase as any).from("questions").upsert([
      { id: a.id, sort_order: b.sort_order },
      { id: b.id, sort_order: a.sort_order },
    ]);
    if (error) toast.error(error.message);
    else load();
  };

  const groups = (() => {
    if (groupBy === "none")
      return [{ key: "__all", label: "Toutes les questions", items: parents }];
    const map = new Map<string, { key: string; label: string; items: Question[] }>();
    for (const q of parents) {
      let key = "__none";
      let label = "Sans classement";
      if (groupBy === "folder" && q.folder_id) {
        key = q.folder_id;
        label = folders.find((f) => f.id === q.folder_id)?.name ?? "Cours";
      } else if (groupBy === "folder") label = "Sans cours";
      else if (groupBy === "rotation") {
        const rids =
          q.rotation_ids && q.rotation_ids.length
            ? q.rotation_ids
            : q.rotation_id
              ? [q.rotation_id]
              : [];
        if (rids.length === 0) {
          const g = map.get("__none") ?? { key: "__none", label: "Sans rotation", items: [] };
          g.items.push(q);
          map.set("__none", g);
        } else {
          for (const rid of rids) {
            const rlbl = rotations.find((r) => r.id === rid)?.label ?? "Rotation";
            const g = map.get(rid) ?? { key: rid, label: rlbl, items: [] };
            g.items.push(q);
            map.set(rid, g);
          }
        }
        continue;
      } else if (groupBy === "year" && q.exam_year != null) {
        key = String(q.exam_year);
        label = `Année ${q.exam_year}`;
      } else if (groupBy === "year") label = "Sans année";
      const g = map.get(key) ?? { key, label, items: [] };
      g.items.push(q);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) =>
      a.key === "__none"
        ? 1
        : b.key === "__none"
          ? -1
          : a.label.localeCompare(b.label, undefined, { numeric: true }),
    );
  })();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <button
          type="button"
          onClick={() => setPanelOpen((v) => !v)}
          className="flex items-center gap-2 text-left hover:opacity-80"
          aria-expanded={panelOpen}
        >
          {panelOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <CardTitle className="text-base">Questions ({items.length})</CardTitle>
        </button>
        {canManage && (
          <div className="flex gap-2">
            <Select value={groupBy} onValueChange={(v) => changeGroupBy(v as any)}>
              <SelectTrigger className="h-9 w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Grouper par : aucun</SelectItem>
                <SelectItem value="folder">Grouper par : cours</SelectItem>
                <SelectItem value="rotation">Grouper par : rotation (Pn)</SelectItem>
                <SelectItem value="year">Grouper par : année d'examen</SelectItem>
              </SelectContent>
            </Select>
            <ImportFromFiles
              moduleId={moduleId}
              year={year}
              rotations={rotations}
              folders={folders}
              onImported={load}
            />
            <CaseForm
              moduleId={moduleId}
              year={year}
              rotations={rotations}
              folders={folders}
              onCreated={load}
            />
            <Button
              size="sm"
              onClick={() => {
                setPanelOpen(true);
                setOpen((v) => !v);
              }}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              {open ? "Fermer" : "Ajouter"}
            </Button>
          </div>
        )}
      </CardHeader>
      {panelOpen && (
        <CardContent className="space-y-3">
          {open && canManage && (
            <NewQuestionForm
              moduleId={moduleId}
              year={year}
              rotations={rotations}
              folders={folders}
              onCreated={() => {
                load();
                setOpen(false);
              }}
            />
          )}
          {canManage && parents.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span className="text-xs text-muted-foreground">
                  {selected.size > 0 ? `${selected.size} sélectionnée(s)` : "Tout sélectionner"}
                </span>
              </label>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-end gap-3">
                  <div className="w-[190px] space-y-1">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Rotation (Pn)
                    </div>
                    <div className="flex items-center gap-1">
                      <MultiSearchableSelect
                        values={bulkRotationIds}
                        onValuesChange={setBulkRotationIds}
                        options={rotationMultiOptions(rotations)}
                        placeholder="Assigner des rotations…"
                        searchPlaceholder="Rechercher une rotation…"
                        triggerClassName="h-8"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 px-2 text-xs"
                        disabled={bulkBusy}
                        onClick={() =>
                          bulkAssign({
                            rotation_id: primaryRotation(bulkRotationIds, rotations),
                            rotation_ids: bulkRotationIds,
                          } as any)
                        }
                      >
                        {bulkRotationIds.length ? "Appliquer" : "Retirer"}
                      </Button>
                    </div>
                  </div>
                  <div className="w-[190px] space-y-1">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Année d'examen
                    </div>
                    <div className="flex items-center gap-1">
                      <MultiSearchableSelect
                        values={bulkYearValues}
                        onValuesChange={setBulkYearValues}
                        options={yearMultiOptions(tr, year)}
                        placeholder="Assigner des années…"
                        searchPlaceholder="Rechercher une année…"
                        triggerClassName="h-8"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-8 px-2 text-xs"
                        disabled={bulkBusy}
                        onClick={() => {
                          const nums = bulkYearValues.map(Number).filter((n) => Number.isFinite(n));
                          bulkAssign({
                            exam_years: nums,
                            exam_year: nums.length ? Math.max(...nums) : null,
                          } as any);
                        }}
                      >
                        {bulkYearValues.length ? "Appliquer" : "Retirer"}
                      </Button>
                    </div>
                  </div>
                  <div className="w-[200px] space-y-1">
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Cours
                    </div>
                    <SearchableSelect
                      value=""
                      onValueChange={(v) => bulkAssign({ folder_id: v === "__none" ? null : v })}
                      options={folderOptions(tr, folders)}
                      placeholder="Assigner un cours…"
                      triggerClassName="h-8"
                    />
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="destructive" disabled={bulkBusy}>
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        Supprimer
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Supprimer {selected.size} question(s) ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Action irréversible. Les sous-questions des cas cliniques sélectionnés
                          seront aussi supprimées.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={bulkDelete}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Supprimer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Annuler
                  </Button>
                </div>
              )}
            </div>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aucune question. Créez-en pour permettre aux étudiants de composer des sessions.
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => {
                const gOpen = openGroups[g.key] ?? false;
                const gSelectedCount = g.items.filter((q) => selected.has(q.id)).length;
                const gAllSelected = g.items.length > 0 && gSelectedCount === g.items.length;
                const gSomeSelected = gSelectedCount > 0 && gSelectedCount < g.items.length;
                const toggleGroup = (e?: React.MouseEvent | React.ChangeEvent) => {
                  e?.stopPropagation();
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (gAllSelected) g.items.forEach((q) => next.delete(q.id));
                    else g.items.forEach((q) => next.add(q.id));
                    return next;
                  });
                };
                return (
                  <div
                    key={g.key}
                    className={groupBy === "none" ? "space-y-2" : "rounded-lg border"}
                  >
                    {groupBy !== "none" && (
                      <button
                        onClick={() => setOpenGroups((p) => ({ ...p, [g.key]: !gOpen }))}
                        className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium hover:bg-accent"
                      >
                        <span className="flex items-center gap-2">
                          {gOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                          {g.label}
                        </span>
                        <span className="flex items-center gap-2">
                          {canManage && groupBy === "folder" && (
                            <span onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={gSomeSelected ? "indeterminate" : gAllSelected}
                                onCheckedChange={() => toggleGroup()}
                                aria-label={`${tr("Sélectionner tout")} ${g.label}`}
                              />
                            </span>
                          )}
                          <Badge variant="secondary">{g.items.length}</Badge>
                        </span>
                      </button>
                    )}
                    {(groupBy === "none" || gOpen) && (
                      <div className={groupBy === "none" ? "space-y-2" : "space-y-2 border-t p-2"}>
                        {g.items.map((q) => {
                          const idx = parents.indexOf(q);
                          // Any admin with manage_quiz can edit or delete every question.
                          const canDel = isSuper || canManage;
                          const canEdit = canManage;
                          const children = items.filter((c) => c.parent_id === q.id);
                          return (
                            <div key={q.id} className="rounded-md border px-3 py-2 text-sm">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="font-medium truncate">{q.stem}</div>
                                  <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                                    <Badge variant="secondary" className="text-[10px]">
                                      {tr(QTYPE_LABEL[q.type])}
                                    </Badge>
                                    <Badge
                                      variant={q.polarity === "correct" ? "default" : "destructive"}
                                      className="text-[10px]"
                                    >
                                      {q.polarity === "correct" ? tr("Juste") : tr("Faux")}
                                    </Badge>
                                    {(() => {
                                      const rids =
                                        q.rotation_ids && q.rotation_ids.length
                                          ? q.rotation_ids
                                          : q.rotation_id
                                            ? [q.rotation_id]
                                            : [];
                                      return rids.map((rid) => {
                                        const lbl = rotations.find((r) => r.id === rid)?.label;
                                        return lbl ? (
                                          <Badge
                                            key={rid}
                                            variant="outline"
                                            className="text-[10px] border-primary/40 text-primary"
                                          >
                                            {lbl}
                                          </Badge>
                                        ) : null;
                                      });
                                    })()}
                                    {(() => {
                                      const yrs = (
                                        q.exam_years && q.exam_years.length
                                          ? q.exam_years
                                          : q.exam_year != null
                                            ? [q.exam_year]
                                            : []
                                      )
                                        .slice()
                                        .sort((a, b) => b - a);
                                      if (!yrs.length) return null;
                                      return (
                                        <Badge
                                          variant="outline"
                                          className="text-[10px] border-accent/50 text-accent"
                                        >
                                          {tr("Année")} {yrs[0]}
                                          {yrs.length > 1
                                            ? ` (+${yrs.length - 1} : ${yrs.slice(1).join(", ")})`
                                            : ""}
                                        </Badge>
                                      );
                                    })()}
                                    {q.session_kind && (
                                      <Badge variant="outline" className="text-[10px]">
                                        {q.session_kind}
                                        {q.session_number ? " " + q.session_number : ""}
                                        {q.session_title ? " — " + q.session_title : ""}
                                      </Badge>
                                    )}
                                    {q.type === "cas_clinique" && (
                                      <Badge variant="outline" className="text-[10px]">
                                        {children.length} {tr("sous-question(s)")}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-start gap-1">
                                  {canManage && (
                                    <>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={idx === 0}
                                        onClick={() => move(q, -1)}
                                        title={tr("Monter")}
                                      >
                                        <ArrowUp className="h-4 w-4" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        disabled={idx === parents.length - 1}
                                        onClick={() => move(q, 1)}
                                        title={tr("Descendre")}
                                      >
                                        <ArrowDown className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                  {canEdit && (
                                    <EditQuestionDialog
                                      question={q}
                                      rotations={rotations}
                                      folders={folders}
                                      onSaved={load}
                                    />
                                  )}
                                  {canDel && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="text-destructive"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>
                                            {tr("Supprimer cette question ?")}
                                          </AlertDialogTitle>
                                          <AlertDialogDescription>
                                            {tr("Action irréversible.")}
                                            {q.type === "cas_clinique" && children.length
                                              ? tr(
                                                  " Les sous-questions seront également supprimées.",
                                                )
                                              : ""}
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>{tr("Annuler")}</AlertDialogCancel>
                                          <AlertDialogAction
                                            onClick={() => remove(q)}
                                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                          >
                                            {tr("Supprimer")}
                                          </AlertDialogAction>
                                        </AlertDialogFooter>
                                      </AlertDialogContent>
                                    </AlertDialog>
                                  )}
                                  {canManage && (
                                    <input
                                      type="checkbox"
                                      className="mt-2.5 h-4 w-4"
                                      checked={selected.has(q.id)}
                                      onChange={() => toggleSelect(q.id)}
                                      aria-label={tr("Sélectionner cette question")}
                                    />
                                  )}
                                </div>
                              </div>
                              {q.type === "cas_clinique" && children.length > 0 && (
                                <div className="mt-2 space-y-1 border-l-2 border-muted pl-3">
                                  {children.map((c) => (
                                    <div
                                      key={c.id}
                                      className="text-xs text-muted-foreground flex items-center gap-1.5"
                                    >
                                      <span className="flex-1 truncate">
                                        • [{tr(QTYPE_LABEL[c.type])}] {c.stem}
                                      </span>
                                      {(isSuper || canManage) && (
                                        <EditQuestionDialog
                                          question={c}
                                          rotations={rotations}
                                          folders={folders}
                                          onSaved={load}
                                        />
                                      )}
                                    </div>
                                  ))}
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
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

type FileJob = {
  id: string;
  name: string;
  kind: "image" | "pdf" | "docx" | "text" | "json";
  preview: string | null;
  status: "pending" | "analyzing" | "done" | "error";
  error?: string;
  count: number;
  chunksTotal?: number;
  chunksDone?: number;
  /** Questions counted in the source document (0 = inconnu). */
  expected?: number;
  /** Nombre de questions indiqué manuellement par l'admin (prioritaire). */
  declared?: number;
  /** Base d'ordre global attribuée lors de l'analyse (préserve l'ordre du fichier). */
  baseOrder?: number;
  /** Non-blocking diagnostics (extraction incomplète, page scannée…). */
  warnings?: string[];
  /** JSON importé comme un cas clinique unique (énoncé commun + sous-questions). */
  asCase?: boolean;
};

type ReviewItem = ExtractedQ & {
  keep: boolean;
  source: string;
  rotation_id: string;
  rotation_ids: string[];
  folder_id: string;
  exam_year: string;
  exam_years: string[];
  preview?: boolean;
  year_detected?: number | null;
  _order?: number;
};

function resolveImportAssignments(q: ExtractedQ, rotations: Rotation[]) {
  const years = parseYears(q.year_hints ?? [q.year_hint], q.year_hint);
  const rotationIds = matchRotations(q.rotation_hints ?? [q.rotation_hint], rotations, { years });
  const rotationId = primaryRotation(rotationIds, rotations);
  const latest = years.length ? Math.max(...years) : null;
  return {
    rotation_id: rotationId ?? "__none",
    rotation_ids: rotationIds,
    exam_year: latest != null ? String(latest) : "__none",
    exam_years: years.map(String),
    year_detected: latest,
  };
}

type GoogleAiCheck = {
  ok: boolean;
  message: string;
  models: Array<{
    model: string;
    engine?: string;
    ok: boolean;
    latencyMs: number;
    reply?: string;
    error?: string;
  }>;
};

/** Admin health check for the AI engines used by question extraction. */
function GoogleAiTestButton() {
  const { tr } = useI18n();
  const runTest = useServerFn(testGoogleAi);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<GoogleAiCheck | null>(null);

  const onClick = async () => {
    setTesting(true);
    setResult(null);
    try {
      const r = (await runTest({} as any)) as GoogleAiCheck;
      setResult(r);
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
    } catch (e: any) {
      const message = e?.message ?? tr("Test impossible");
      setResult({ ok: false, message, models: [] });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onClick} disabled={testing}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          {testing ? tr("Test en cours…") : tr("Tester l'IA")}
        </Button>
        {result && (
          <Badge variant={result.ok ? "secondary" : "destructive"}>
            {result.ok ? tr("IA disponible") : tr("IA indisponible")}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {tr("Vérifie la disponibilité de l'IA intégrée utilisée pour l'extraction.")}
        </span>
      </div>
      {result && (
        <div className="space-y-1 text-xs">
          <div className={result.ok ? "text-muted-foreground" : "text-destructive"}>
            {result.message}
          </div>
          {result.models.map((m) => (
            <div key={`${m.engine ?? ""}-${m.model}`} className="flex flex-wrap items-center gap-2">
              <Badge variant={m.ok ? "secondary" : "destructive"}>{m.model}</Badge>
              {m.engine && <span className="text-muted-foreground">{m.engine}</span>}
              {m.ok ? (
                <span className="text-muted-foreground">
                  {tr("réponse")} « {m.reply || "—"} » {tr("en")} {m.latencyMs} ms
                </span>
              ) : (
                <span className="text-destructive">{m.error}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImportFromFiles({
  moduleId,
  year,
  rotations,
  folders,
  onImported,
}: {
  moduleId: string;
  year: number;
  rotations: Rotation[];
  folders: Folder[];
  onImported: () => void;
}) {
  const { tr } = useI18n();
  const extractImg = useServerFn(extractQuestionsFromImage);
  const prepDocx = useServerFn(prepareDocxChunks);
  const extractHtml = useServerFn(extractQuestionsFromHtmlChunk);
  const extractPdfChunk = useServerFn(extractQuestionsFromPdfChunk);
  const prepText = useServerFn(prepareTextChunks);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<FileJob[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [bulkRotations, setBulkRotations] = useState<string[]>([]);
  const [bulkFolder, setBulkFolder] = useState<string>("__keep");
  const [bulkYears, setBulkYears] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [previewAll, setPreviewAll] = useState(false);
  const [engines, setEngines] = useState<string[]>([]);
  /** Mode sans IA : analyse locale gratuite (0 crédit). */
  const [noAi, setNoAi] = useState(false);
  /** Détection des cas cliniques (regroupement des sous-questions). */
  const [detectCases, setDetectCases] = useState(true);
  /** Collage direct de JSON (0 crédit). */
  const [jsonPaste, setJsonPaste] = useState("");
  /** JSON = un cas clinique (énoncé commun + sous-questions). */
  const [jsonAsCase, setJsonAsCase] = useState(false);
  /** Confirm-before-import preview. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Shared cooldown: when Google rate-limits us, every worker waits. */
  const cooldownUntilRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setHint("");
    setItems([]);
    setJobs([]);
    setEngines([]);
  };

  const noteEngine = (e?: string) => {
    if (!e) return;
    setEngines((prev) => (prev.includes(e) ? prev : [...prev, e]));
  };

  const readAsDataUrl = (f: File) =>
    new Promise<string>((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result));
      r.onerror = () => rej(r.error);
      r.readAsDataURL(f);
    });

  const arrayBufferToBase64 = (buf: ArrayBuffer | Uint8Array): string => {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
    }
    return btoa(binary);
  };

  const detectKind = (f: File): FileJob["kind"] | null => {
    const m = (f.type || "").toLowerCase();
    const n = f.name.toLowerCase();
    if (m.startsWith("image/")) return "image";
    if (m === "application/pdf" || n.endsWith(".pdf")) return "pdf";
    if (
      m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      n.endsWith(".docx")
    )
      return "docx";
    if (m === "application/json" || n.endsWith(".json")) return "json";
    if (m.startsWith("text/") || n.endsWith(".md") || n.endsWith(".markdown") || n.endsWith(".txt"))
      return "text";
    return null;
  };

  const addFiles = async (fs: FileList | File[]) => {
    const arr = Array.from(fs);
    const next: FileJob[] = [];
    for (const f of arr) {
      const kind = detectKind(f);
      if (!kind) {
        toast.error(`${tr("Format non supporté")}: ${f.name}`);
        continue;
      }
      let preview: string | null = null;
      if (kind === "image") {
        try {
          preview = await readAsDataUrl(f);
        } catch {}
      }
      next.push({
        id: crypto.randomUUID(),
        name: f.name,
        kind,
        preview,
        status: "pending",
        count: 0,
        asCase: kind === "json" ? jsonAsCase : undefined,
      });
      // stash the File for analyze phase
      (next[next.length - 1] as any)._file = f;
    }
    setJobs((prev) => [...prev, ...next]);
  };

  const removeJob = (id: string) => setJobs((prev) => prev.filter((j) => j.id !== id));

  /** Turn pasted JSON into a normal JSON job (same pipeline as a .json file). */
  const addPastedJson = () => {
    const raw = jsonPaste.trim();
    if (!raw) {
      toast.error(tr("Collez d'abord du JSON."));
      return;
    }
    try {
      const n = parseQuestionsJson(raw, { forceCase: jsonAsCase }).length;
      const idx = jobs.filter((j) => j.name.startsWith(tr("Collé"))).length + 1;
      const file = new File([raw], `${tr("Collé")} ${idx} (JSON).json`, {
        type: "application/json",
      });
      addFiles([file]);
      setJsonPaste("");
      toast.success(`${n} ${tr("question(s) détectée(s) dans le JSON collé.")}`);
    } catch (e: any) {
      toast.error(e?.message ?? tr("JSON invalide"));
    }
  };

  const CONCURRENCY = 8;

  const isRateLimit = (e: any) =>
    /429|quota|rate.?limit|RESOURCE_EXHAUSTED|trop de requêtes/i.test(
      String(e?.message ?? e ?? ""),
    );

  /** Wait out any global cooldown set by a previous rate-limited chunk. */
  const waitForCooldown = async () => {
    const wait = cooldownUntilRef.current - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  };
  type Ctx = {
    year_hint: string | null;
    rotation_hint: string | null;
    course_hint: string | null;
    case_stem: string | null;
  };
  type Task = {
    jobId: string;
    source: string;
    order: number; // global ordering (file index * 1_000_000 + chunk index)
    run: () => Promise<{ qs: ExtractedQ[]; warning?: string }>;
  };

  /** Local context (année/rotation/cours lues au-dessus de chaque question)
   *  wins over whatever the model guessed. */
  const applyContexts = (qs: ExtractedQ[], contexts: Ctx[]): ExtractedQ[] =>
    qs.map((q, i) => {
      const ctx = contexts[i];
      if (!ctx) return q;
      return {
        ...q,
        year_hint: ctx.year_hint ?? q.year_hint,
        rotation_hint: ctx.rotation_hint ?? q.rotation_hint,
        course_hint: ctx.course_hint ?? q.course_hint,
        // Deterministically detected (explicit "Cas clinique n°X" marker) —
        // wins over the model's own guess so every question in the same
        // vignette group gets byte-identical text, even across separate
        // chunk/AI calls, keeping _importAll's case_stem grouping intact.
        case_stem: ctx.case_stem ?? q.case_stem,
      };
    });

  /** Build the extraction tasks for one file (prep step for DOCX + PDF). */
  const prepareJobTasks = async (
    job: FileJob,
    baseOrder: number,
    h?: string,
  ): Promise<{ tasks: Task[]; expected: number }> => {
    const tasks: Task[] = [];
    let expected = 0;
    const file: File = (job as any)._file;
    {
      {
        if (job.kind === "image") {
          if (noAi)
            throw new Error(
              tr("Mode sans IA : les images ne peuvent pas être analysées localement."),
            );
          const dataUrl = await readAsDataUrl(file);
          tasks.push({
            jobId: job.id,
            source: job.name,
            order: baseOrder,
            run: async () => {
              const r = await extractImg({
                data: { imageDataUrl: dataUrl, hint: h, detectCases },
              });
              noteEngine((r as any).engine);
              return { qs: r.questions ?? [] };
            },
          });
          setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, chunksTotal: 1 } : j)));
        } else if (job.kind === "json") {
          // 100% déterministe : aucune IA, aucun crédit consommé.
          const raw = await file.text();
          const qs = parseQuestionsJson(raw, { forceCase: !!job.asCase });
          expected += qs.length;
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, chunksTotal: 1, expected: qs.length } : j)),
          );
          tasks.push({
            jobId: job.id,
            source: job.name,
            order: baseOrder,
            run: async () => {
              noteEngine("json");
              return { qs };
            },
          });
        } else if (job.kind === "text") {
          const raw = await file.text();
          const { chunks, totalExpected } = await prepText({
            data: { text: raw, detectCases },
          });
          if (!chunks.length) throw new Error(tr("Fichier vide ou illisible"));
          expected += totalExpected;
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id ? { ...j, chunksTotal: chunks.length, expected: totalExpected } : j,
            ),
          );
          chunks.forEach((c: (typeof chunks)[number], i: number) =>
            tasks.push({
              jobId: job.id,
              source: job.name,
              order: baseOrder + i,
              run: async () => {
                const r = await extractHtml({
                  data: {
                    html: c.html,
                    hint: h,
                    expected: c.expected,
                    allowNoAi: noAi,
                    detectCases,
                  },
                });
                noteEngine((r as any).engine);
                return {
                  qs: applyContexts(r.questions ?? [], c.contexts as Ctx[]),
                  warning: (r as any).warning,
                };
              },
            }),
          );
        } else if (job.kind === "docx") {
          const dataUrl = await readAsDataUrl(file);
          const { chunks, totalExpected } = await prepDocx({
            data: { docxDataUrl: dataUrl, detectCases },
          });
          expected += totalExpected;
          setJobs((prev) =>
            prev.map((j) =>
              j.id === job.id ? { ...j, chunksTotal: chunks.length, expected: totalExpected } : j,
            ),
          );
          chunks.forEach((c: (typeof chunks)[number], i: number) =>
            tasks.push({
              jobId: job.id,
              source: job.name,
              order: baseOrder + i,
              run: async () => {
                const r = await extractHtml({
                  data: {
                    html: c.html,
                    colorHint: c.colorHint,
                    hint: h,
                    expected: c.expected,
                    allowNoAi: noAi,
                    detectCases,
                  },
                });
                noteEngine((r as any).engine);
                return {
                  qs: applyContexts(r.questions ?? [], c.contexts as Ctx[]),
                  warning: (r as any).warning,
                };
              },
            }),
          );
        } else if (job.kind === "pdf") {
          const bytes = await file.arrayBuffer();

          // Fast path: PDFs with a real text layer are parsed in the browser and
          // sent as text (tiny payloads, no per-chunk PDF re-upload).
          let usedTextPath = false;
          try {
            const { extractPdfText } = await import("@/lib/pdfText");
            const { pages, scannedPages } = await extractPdfText(bytes.slice(0));
            const scannedRatio = pages.length ? scannedPages.length / pages.length : 1;
            if (scannedRatio <= 0.3) {
              const text = pages.join("\n");
              const { chunks, totalExpected } = await prepText({
                data: { text, detectCases },
              });
              if (chunks.length) {
                usedTextPath = true;
                expected += totalExpected;
                setJobs((prev) =>
                  prev.map((j) =>
                    j.id === job.id
                      ? {
                          ...j,
                          chunksTotal: chunks.length,
                          expected: totalExpected,
                          warnings: scannedPages.length
                            ? [
                                `${scannedPages.length} ${tr("page(s) sans texte (scan) ignorée(s) par la lecture rapide")}`,
                              ]
                            : [],
                        }
                      : j,
                  ),
                );
                chunks.forEach((c: (typeof chunks)[number], i: number) =>
                  tasks.push({
                    jobId: job.id,
                    source: job.name,
                    order: baseOrder + i,
                    run: async () => {
                      const r = await extractHtml({
                        data: {
                          html: c.html,
                          hint: h,
                          expected: c.expected,
                          allowNoAi: noAi,
                          detectCases,
                        },
                      });
                      noteEngine((r as any).engine);
                      return {
                        qs: applyContexts(r.questions ?? [], c.contexts as Ctx[]),
                        warning: (r as any).warning,
                      };
                    },
                  }),
                );
              }
            }
          } catch {
            // pdf.js unavailable or unreadable text layer — fall back to the AI PDF path.
          }
          if (usedTextPath) return { tasks, expected };

          if (noAi) {
            throw new Error(
              tr(
                "Mode sans IA : ce PDF n'a pas de couche texte lisible (scan). Décochez le mode sans IA ou importez un fichier Word.",
              ),
            );
          }
          const { PDFDocument } = await import("pdf-lib");
          const src = await PDFDocument.load(bytes);
          const totalPages = src.getPageCount();
          const PAGES_PER_CHUNK = 3;
          const chunkCount = Math.max(1, Math.ceil(totalPages / PAGES_PER_CHUNK));
          setJobs((prev) =>
            prev.map((j) => (j.id === job.id ? { ...j, chunksTotal: chunkCount } : j)),
          );
          for (let ci = 0; ci < chunkCount; ci++) {
            const start = ci * PAGES_PER_CHUNK;
            const end = Math.min(start + PAGES_PER_CHUNK, totalPages);
            const indices = Array.from({ length: end - start }, (_, k) => start + k);
            // Materialise the sub-PDF once, so the task closure only carries the data url.
            const sub = await PDFDocument.create();
            const copied = await sub.copyPages(src, indices);
            copied.forEach((p) => sub.addPage(p));
            const subBytes = await sub.save();
            const b64 = arrayBufferToBase64(subBytes);
            const dataUrl = `data:application/pdf;base64,${b64}`;
            const chunkName = `${job.name} (p${start + 1}-${end})`;
            tasks.push({
              jobId: job.id,
              source: job.name,
              order: baseOrder + ci,
              run: async () => {
                const r = await extractPdfChunk({
                  data: { pdfDataUrl: dataUrl, filename: chunkName, hint: h, detectCases },
                });
                noteEngine((r as any).engine);
                return { qs: r.questions ?? [], warning: (r as any).warning as string | undefined };
              },
            });
          }
        }
      }
    }
    return { tasks, expected };
  };

  const analyzeAll = async () => {
    if (jobs.length === 0) {
      toast.error(tr("Ajoutez au moins un fichier"));
      return;
    }
    setBusy(true);
    setItems([]);
    setEngines([]);
    cooldownUntilRef.current = 0;
    const h = hint.trim() || undefined;
    /** Questions attendues (déclarées par l'admin, sinon comptées localement). */
    let expectedTotal = 0;
    const tasks: Task[] = [];
    const activeJobs = jobs.filter((j) => j.status !== "done");

    for (let fi = 0; fi < activeJobs.length; fi++) {
      const job = activeJobs[fi];
      const jobBase = fi * 1_000_000;
      setJobs((prev) =>
        prev.map((j) =>
          j.id === job.id
            ? {
                ...j,
                status: "analyzing",
                error: undefined,
                chunksTotal: undefined,
                chunksDone: 0,
                count: 0,
                warnings: [],
                expected: 0,
                baseOrder: jobBase,
              }
            : j,
        ),
      );
      try {
        const { tasks: jt, expected } = await prepareJobTasks(job, jobBase, h);
        tasks.push(...jt);
        expectedTotal += job.declared && job.declared > 0 ? job.declared : expected;
      } catch (e: any) {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "error", error: e?.message ?? tr("Préparation impossible") }
              : j,
          ),
        );
      }
    }

    if (tasks.length === 0) {
      setBusy(false);
      toast.error(tr("Aucun fichier à analyser"));
      return;
    }

    // Run tasks with bounded concurrency, streaming into the review list.
    const streamed: (ExtractedQ & { source: string; order: number })[] = [];
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
      while (true) {
        const idx = cursor++;
        if (idx >= tasks.length) return;
        const t = tasks[idx];
        try {
          await waitForCooldown();
          let res: { qs: ExtractedQ[]; warning?: string };
          try {
            res = await t.run();
          } catch (err: any) {
            if (!isRateLimit(err)) throw err;
            // Rate limited: pause every worker, then give this chunk one more go.
            cooldownUntilRef.current = Date.now() + 20_000;
            await waitForCooldown();
            res = await t.run();
          }
          const { qs, warning } = res;
          // 1000 slots per chunk so a long chunk never overlaps the next one.
          qs.forEach((q, i) =>
            streamed.push({ ...q, source: t.source, order: t.order * 1000 + i }),
          );
          setJobs((prev) =>
            prev.map((j) => {
              if (j.id !== t.jobId) return j;
              const done = (j.chunksDone ?? 0) + 1;
              const total = j.chunksTotal ?? done;
              return {
                ...j,
                chunksDone: done,
                count: (j.count ?? 0) + qs.length,
                warnings: warning ? [...(j.warnings ?? []), warning] : j.warnings,
                status: done >= total ? "done" : "analyzing",
              };
            }),
          );
          // Stream the review list, keeping global order.
          const sorted = [...streamed].sort((a, b) => a.order - b.order);
          // Dedupe adjacent identical stems (chunk boundary safety).
          const deduped: typeof sorted = [];
          for (const q of sorted) {
            const last = deduped[deduped.length - 1];
            if (last && last.stem.trim() === q.stem.trim() && last.source === q.source) continue;
            deduped.push(q);
          }
          setItems(
            deduped.map((q) => {
              const fid = matchFolder(q.course_hint ?? null, folders);
              return {
                ...q,
                keep: true,
                source: q.source,
                ...resolveImportAssignments(q, rotations),
                folder_id: fid ?? "__none",
                preview: true,
                _order: q.order,
              };
            }),
          );
          setPreviewAll(true);
        } catch (e: any) {
          setJobs((prev) =>
            prev.map((j) => {
              if (j.id !== t.jobId) return j;
              const done = (j.chunksDone ?? 0) + 1;
              const total = j.chunksTotal ?? done;
              return {
                ...j,
                chunksDone: done,
                status: done >= total ? (j.count > 0 ? "done" : "error") : "analyzing",
                error: e?.message ?? tr("Erreur"),
              };
            }),
          );
        }
      }
    });
    await Promise.all(workers);

    setBusy(false);
    const finalCount = streamed.length;
    if (finalCount === 0) {
      toast.error(tr("Aucune question détectée"));
    } else {
      if (expectedTotal > finalCount) {
        toast.warning(
          `${finalCount} ${tr("question(s) extraite(s) sur")} ${expectedTotal} ${tr("détectée(s) — relancez les fichiers incomplets")}`,
        );
      } else {
        toast.success(`${finalCount} ${tr("question(s) détectée(s)")}`);
      }
    }
  };

  const importAll = async () => {
    if (items.filter((i) => i.keep).length === 0) {
      toast.error(tr("Rien à importer"));
      return;
    }
    setConfirmOpen(true);
  };
  const confirmImport = async () => {
    setConfirmOpen(false);
    await _importAll();
  };

  /** Re-run one file asking the AI for the questions still missing. */
  const completeJob = async (job: FileJob) => {
    const target = job.declared && job.declared > 0 ? job.declared : (job.expected ?? 0);
    const existing = items.filter((i) => i.source === job.name);
    const missing = Math.max(0, target - existing.length);
    if (missing === 0) {
      toast.info(tr("Aucune question manquante pour ce fichier"));
      return;
    }
    const norm = (s: string) =>
      s
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const seen = new Set(existing.map((i) => norm(i.stem)));
    const extraHint = [
      hint.trim(),
      `Ce document contient exactement ${target} questions. ${existing.length} seulement ont été extraites : il en manque ${missing}. Relis le fichier ENTIER et renvoie TOUTES les questions, sans en omettre aucune, y compris celles situées en fin de document.`,
    ]
      .filter(Boolean)
      .join(" ");

    setBusy(true);
    setJobs((prev) =>
      prev.map((x) =>
        x.id === job.id
          ? {
              ...x,
              status: "analyzing",
              error: undefined,
              chunksDone: 0,
              chunksTotal: undefined,
              warnings: [],
            }
          : x,
      ),
    );
    try {
      // Reuse the file's original ordering base so recovered questions slot back
      // into their real position in the document instead of landing at the end.
      const retryBase = job.baseOrder ?? 900_000;
      const { tasks } = await prepareJobTasks(job, retryBase, extraHint);
      setJobs((prev) =>
        prev.map((x) => (x.id === job.id ? { ...x, chunksTotal: tasks.length } : x)),
      );
      const found: (ExtractedQ & { _ord: number })[] = [];
      let cursor = 0;
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, async () => {
          while (true) {
            const idx = cursor++;
            if (idx >= tasks.length) return;
            const t = tasks[idx];
            try {
              const { qs } = await t.run();
              qs.forEach((q, i) => {
                const key = norm(q.stem);
                if (seen.has(key)) return;
                seen.add(key);
                // +0.5 keeps a recovered question right after the already-extracted
                // question occupying the same slot, preserving document order.
                found.push({ ...q, _ord: t.order * 1000 + i + 0.5 });
              });
            } catch {
              /* chunk failed — other chunks still contribute */
            }
            setJobs((prev) =>
              prev.map((x) =>
                x.id === job.id ? { ...x, chunksDone: (x.chunksDone ?? 0) + 1 } : x,
              ),
            );
          }
        }),
      );

      if (found.length === 0) {
        toast.warning(tr("Aucune question supplémentaire trouvée"));
      } else {
        setItems((prev) => {
          const added: ReviewItem[] = found.map((q) => {
            const fid = matchFolder(q.course_hint ?? null, folders);
            return {
              ...q,
              keep: true,
              source: job.name,
              ...resolveImportAssignments(q, rotations),
              folder_id: fid ?? "__none",
              preview: true,
              _order: q._ord,
            };
          });
          return [...prev, ...added].sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
        });
        toast.success(`${found.length} ${tr("question(s) supplémentaire(s) récupérée(s)")}`);
      }
      setJobs((prev) =>
        prev.map((x) =>
          x.id === job.id ? { ...x, status: "done", count: existing.length + found.length } : x,
        ),
      );
    } catch (e: any) {
      setJobs((prev) =>
        prev.map((x) =>
          x.id === job.id ? { ...x, status: "error", error: e?.message ?? tr("Erreur") } : x,
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  const _importAll = async () => {
    const kept = items
      .filter((i) => i.keep)
      .slice()
      .sort((a, b) => (a._order ?? 0) - (b._order ?? 0));
    if (kept.length === 0) {
      toast.error(tr("Rien à importer"));
      return;
    }
    setBusy(true);
    try {
      // Find current max sort_order for this module so imports append after existing questions.
      const { data: maxRow } = await (supabase as any)
        .from("questions")
        .select("sort_order")
        .eq("module_id", moduleId)
        .order("sort_order", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      const base = Number(maxRow?.sort_order ?? 0);
      const rowFor = (q: ReviewItem, order: number) => ({
        module_id: moduleId,
        year,
        rotation_id: q.rotation_id === "__none" ? null : q.rotation_id,
        rotation_ids: (q.rotation_ids ?? []).filter((r) => r && r !== "__none"),
        folder_id: q.folder_id === "__none" ? null : q.folder_id,
        exam_year: q.exam_year === "__none" ? null : Number(q.exam_year),
        exam_years: (q.exam_years ?? []).map(Number).filter((n) => Number.isFinite(n)),
        type: q.type,
        polarity: "correct",
        stem: q.stem,
        choices: q.type === "qroc" ? null : (q.choices ?? []),
        correct_indices: q.type === "qroc" ? null : (q.correct_indices ?? []),
        model_answer: q.type === "qroc" ? (q.model_answer ?? "") : null,
        explanation: q.explanation,
        parent_id: null,
        sort_order: base + order * 10,
      });
      const fail = (error: any, sampleRow: any, rowCount: number) => {
        console.error("[importAll] insert failed", { error, sampleRow, rowCount });
        const detail = [error.message, error.details, error.hint, error.code]
          .filter(Boolean)
          .join(" — ");
        throw new Error(detail || tr("Insert failed"));
      };

      // Clinical cases: questions sharing a `case_stem` become sub-questions of
      // a single `cas_clinique` parent inserted first.
      const caseParentId = new Map<string, string>();
      const caseKeys: string[] = [];
      for (const q of kept) {
        const k = caseKey(q);
        if (k && !caseKeys.includes(k)) caseKeys.push(k);
      }
      let order = 0;
      if (caseKeys.length) {
        const parentRows = caseKeys.map((k) => {
          const first = kept.find((q) => caseKey(q) === k)!;
          return {
            ...rowFor(first, ++order),
            type: "cas_clinique",
            stem: first.case_stem ?? k,
            choices: null,
            correct_indices: null,
            model_answer: null,
            explanation: null,
          };
        });
        const { data: inserted, error: perr } = await (supabase as any)
          .from("questions")
          .insert(parentRows)
          .select("id");
        if (perr) fail(perr, parentRows[0], parentRows.length);
        (inserted ?? []).forEach((r: any, i: number) => caseParentId.set(caseKeys[i], r.id));
      }

      const rows = kept.map((q) => {
        const k = caseKey(q);
        const parentId = k ? (caseParentId.get(k) ?? null) : null;
        return { ...rowFor(q, ++order), parent_id: parentId };
      });
      const { error } = await (supabase as any).from("questions").insert(rows);
      if (error) fail(error, rows[0], rows.length);
      toast.success(
        `${rows.length} ${tr("question(s) importée(s)")}${caseKeys.length ? ` · ${caseKeys.length} ${tr("cas clinique(s)")}` : ""}`,
      );
      onImported();
      setOpen(false);
      reset();
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur d'import"));
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (i: number, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((it, k) => (k === i ? { ...it, ...patch } : it)));
  };

  // Normalized grouping key for "questions sharing a cas-clinique énoncé" —
  // shared with _importAll so the review list and the actual import agree on
  // which questions belong together.
  const caseKey = (q: ReviewItem) =>
    (q.case_stem ?? "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Editing a shared case_stem updates every question in that case at once,
   *  so they stay byte-identical (required for the grouping above to hold). */
  const updateCaseStem = (key: string, html: string) => {
    setItems((prev) => prev.map((it) => (caseKey(it) === key ? { ...it, case_stem: html } : it)));
  };

  const applyBulk = () => {
    if (!bulkRotations.length && bulkFolder === "__keep" && !bulkYears.length) return;
    const clearRot = bulkRotations.includes("__none");
    const rotIds = clearRot ? [] : bulkRotations;
    const clearYear = bulkYears.includes("__none");
    const yearVals = clearYear ? [] : bulkYears;
    setItems((prev) =>
      prev.map((it) => {
        if (!it.keep) return it;
        const next = { ...it };
        if (bulkRotations.length) {
          next.rotation_ids = rotIds;
          next.rotation_id = primaryRotation(rotIds, rotations) ?? "__none";
        }
        if (bulkFolder !== "__keep") next.folder_id = bulkFolder;
        if (bulkYears.length) {
          next.exam_years = yearVals;
          const latest = latestYear(yearVals);
          next.exam_year = latest != null ? String(latest) : "__none";
        }
        return next;
      }),
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <ImagePlus className="mr-1.5 h-4 w-4" />
            {tr("Importer")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tr("Importer des QCM (images, PDF, Word, Markdown, TXT, JSON)")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{tr("Fichiers (plusieurs autorisés)")}</Label>
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDragOver(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    addFiles(e.dataTransfer.files);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                role="button"
                tabIndex={0}
                className={`flex flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed px-4 py-8 text-center cursor-pointer transition-colors ${dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30"}`}
              >
                <ImagePlus
                  className={`h-8 w-8 ${dragOver ? "text-primary" : "text-muted-foreground"}`}
                />
                <div className="text-sm font-medium">
                  {dragOver
                    ? tr("Déposez les fichiers ici")
                    : tr("Glissez-déposez ou cliquez pour choisir")}
                </div>
                <p className="text-xs text-muted-foreground">
                  {tr(
                    "PNG, JPG, WebP, GIF, PDF, Word (.docx), Markdown (.md), texte (.txt) ou JSON (.json — extraction exacte, 0 crédit) — plusieurs fichiers à la fois",
                  )}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.md,.markdown,.txt,text/markdown,text/plain,.json,application/json"
                  onChange={(e) => {
                    if (e.target.files) {
                      addFiles(e.target.files);
                      e.target.value = "";
                    }
                  }}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="json-paste" className="text-sm font-medium">
                  {tr("Coller du JSON")}
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={addPastedJson}
                  disabled={busy || !jsonPaste.trim()}
                >
                  {tr("Analyser le JSON")}
                </Button>
              </div>
              <Textarea
                id="json-paste"
                rows={4}
                value={jsonPaste}
                onChange={(e) => setJsonPaste(e.target.value)}
                placeholder='[{"stem":"...","choices":["...","..."],"correct_indices":[0],"explanation":"..."}] ou {"questions":[...]}'
                className="font-mono text-xs"
              />
              <div className="flex items-start justify-between gap-3 rounded-md border bg-muted/30 p-2">
                <div className="space-y-0.5">
                  <Label htmlFor="json-as-case" className="text-sm font-medium">
                    {tr("Cas clinique")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "Le JSON contient un cas clinique : un énoncé commun est créé et toutes les questions deviennent ses sous-questions.",
                    )}
                  </p>
                </div>
                <Switch id="json-as-case" checked={jsonAsCase} onCheckedChange={setJsonAsCase} />
              </div>
              <p className="text-xs text-muted-foreground">
                {tr("Extraction 100 % exacte, sans IA ni crédit. Les explications par proposition")}
                (<code>options[i].explanation</code> {tr("ou")} <code>{'{ "A": "…" }'}</code>){" "}
                {tr("sont importées ligne par ligne.")}
              </p>
            </div>

            {jobs.length > 0 && (
              <div className="space-y-2">
                {jobs.map((j) => (
                  <div
                    key={j.id}
                    className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
                  >
                    {j.preview ? (
                      <img src={j.preview} alt="" className="h-10 w-10 rounded object-cover" />
                    ) : (
                      <div className="h-10 w-10 rounded bg-muted flex items-center justify-center">
                        <FileText className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{j.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {j.kind.toUpperCase()} · {j.status === "pending" && "En attente"}
                        {j.status === "analyzing" &&
                          (j.chunksTotal
                            ? `Analyse ${j.chunksDone ?? 0}/${j.chunksTotal} · ${j.count}${j.expected ? `/${j.expected}` : ""} question(s)`
                            : "Préparation…")}
                        {j.status === "done" &&
                          (() => {
                            const target =
                              j.declared && j.declared > 0 ? j.declared : (j.expected ?? 0);
                            return target && j.count < target ? (
                              <span className="text-amber-500">
                                {j.count}/{target} question(s) extraite(s) — extraction incomplète
                              </span>
                            ) : (
                              `${j.count} question(s) extraite(s)${target ? ` / ${target} attendue(s)` : ""}`
                            );
                          })()}
                        {j.status === "error" && (
                          <span className="text-destructive">Erreur: {j.error}</span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Label className="text-[11px] text-muted-foreground">
                          Nombre de questions
                        </Label>
                        <Input
                          type="number"
                          min={1}
                          value={j.declared ?? ""}
                          placeholder="auto"
                          disabled={j.status === "analyzing"}
                          onChange={(e) => {
                            const v = e.target.value.trim();
                            const n = v === "" ? undefined : Math.max(1, Number(v) || 0);
                            setJobs((prev) =>
                              prev.map((x) => (x.id === j.id ? { ...x, declared: n } : x)),
                            );
                          }}
                          className="h-7 w-20 text-xs"
                        />
                      </div>
                      {(j.warnings?.length ?? 0) > 0 && (
                        <ul className="mt-0.5 text-[11px] text-amber-500 space-y-0.5">
                          {j.warnings!.slice(0, 3).map((w, wi) => (
                            <li key={wi}>• {w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {j.status !== "analyzing" && (
                      <div className="flex items-center gap-1">
                        {j.status === "done" &&
                          (() => {
                            const target =
                              j.declared && j.declared > 0 ? j.declared : (j.expected ?? 0);
                            return target > 0 && j.count < target ? (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={busy}
                                title="Demander à l'IA de retrouver les questions manquantes"
                                onClick={() => completeJob(j)}
                              >
                                <RefreshCw className="mr-1 h-3.5 w-3.5" />
                                Compléter ({target - j.count})
                              </Button>
                            ) : null;
                          })()}
                        {j.status !== "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Relancer ce fichier"
                            onClick={() => {
                              setJobs((prev) =>
                                prev.map((x) =>
                                  x.id === j.id
                                    ? {
                                        ...x,
                                        status: "pending",
                                        error: undefined,
                                        warnings: [],
                                        count: 0,
                                        chunksDone: 0,
                                        chunksTotal: undefined,
                                      }
                                    : x,
                                ),
                              );
                            }}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => removeJob(j.id)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="space-y-1">
              <Label>Indication (optionnel)</Label>
              <Input
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="ex: cardiologie, réponses cochées en vert"
              />
            </div>
            <GoogleAiTestButton />
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <Checkbox
                id="no-ai-mode"
                checked={noAi}
                onCheckedChange={(v) => setNoAi(v === true)}
              />
              <Label htmlFor="no-ai-mode" className="cursor-pointer text-sm font-medium">
                Mode sans IA (gratuit)
              </Label>
              <span className="text-xs text-muted-foreground">
                Lecture locale des fichiers Word / PDF texte bien structurés (1. / A. / Réponse : /
                Explication :) — 0 crédit. Images et PDF scannés nécessitent l'IA.
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
              <Checkbox
                id="detect-cases"
                checked={detectCases}
                onCheckedChange={(v) => setDetectCases(v === true)}
              />
              <Label htmlFor="detect-cases" className="cursor-pointer text-sm font-medium">
                Détection des cas cliniques
              </Label>
              <span className="text-xs text-muted-foreground">
                Regroupe les questions qui partagent un énoncé/vignette clinique commun. Désactivez
                si vos fichiers ne contiennent pas de cas cliniques, pour éviter tout regroupement
                erroné.
              </span>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button onClick={analyzeAll} disabled={jobs.length === 0 || busy}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                {busy ? "Analyse…" : "Extraire les questions"}
              </Button>
            </div>

            {items.length > 0 && (
              <div className="space-y-3 border-t pt-3">
                <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-2 border-b bg-background/95 px-1 py-2 backdrop-blur">
                  <div className="text-sm font-medium">
                    {items.filter((i) => i.keep).length}/{items.length} question(s) prête(s) à
                    importer
                  </div>
                  <Button size="sm" onClick={importAll} disabled={busy || items.length === 0}>
                    <Upload className="mr-1.5 h-4 w-4" />
                    Importer maintenant
                  </Button>
                </div>
                {engines.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">Moteur d'extraction :</span>
                    {engines.map((e) => (
                      <Badge key={e} variant="secondary">
                        {e === "local"
                          ? "Local (0 crédit)"
                          : e === "json"
                            ? "JSON exact (0 crédit)"
                            : "Gemini (IA intégrée)"}
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm font-medium">
                    {items.length} question(s) détectée(s) — vérifiez et assignez avant import
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = !previewAll;
                        setPreviewAll(next);
                        setItems((prev) => prev.map((it) => ({ ...it, preview: next })));
                      }}
                    >
                      {previewAll ? (
                        <>
                          <EyeOff className="mr-1.5 h-4 w-4" />
                          Tout éditer
                        </>
                      ) : (
                        <>
                          <Eye className="mr-1.5 h-4 w-4" />
                          Aperçu global
                        </>
                      )}
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Sélectionnées: {items.filter((i) => i.keep).length}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/40 p-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Rotations (masse)</Label>
                    <div className="w-52">
                      <MultiSearchableSelect
                        values={bulkRotations}
                        onValuesChange={setBulkRotations}
                        options={[
                          { value: "__none", label: tr("— aucune rotation —") },
                          ...rotationMultiOptions(rotations),
                        ]}
                        placeholder="Ne pas changer"
                        searchPlaceholder="Rechercher une rotation…"
                        triggerClassName="h-8"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Années (masse)</Label>
                    <div className="w-48">
                      <MultiSearchableSelect
                        values={bulkYears}
                        onValuesChange={setBulkYears}
                        options={[
                          { value: "__none", label: tr("— aucune année —") },
                          ...yearMultiOptions(tr, year),
                        ]}
                        placeholder="Ne pas changer"
                        searchPlaceholder="Rechercher une année…"
                        triggerClassName="h-8"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Cours / Dossier (masse)</Label>
                    <div className="w-56">
                      <SearchableSelect
                        value={bulkFolder}
                        onValueChange={setBulkFolder}
                        options={[
                          { value: "__keep", label: tr("Ne pas changer") },
                          ...folderOptions(tr, folders, "— aucun —"),
                        ]}
                        triggerClassName="h-8"
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={applyBulk}
                    disabled={!bulkRotations.length && bulkFolder === "__keep" && !bulkYears.length}
                  >
                    Appliquer aux sélectionnées
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setItems((prev) =>
                        prev.map((it) => {
                          return {
                            ...it,
                            ...resolveImportAssignments(it, rotations),
                            folder_id: matchFolder(it.course_hint ?? null, folders) ?? it.folder_id,
                          };
                        }),
                      );
                      toast.success("Détection auto ré-appliquée");
                    }}
                  >
                    Détection auto
                  </Button>
                </div>
                {items.map((q, i) => {
                  const groupKey = caseKey(q);
                  const isNewCaseGroup =
                    groupKey !== "" && (i === 0 || groupKey !== caseKey(items[i - 1]));
                  return (
                    <div key={i}>
                      {isNewCaseGroup && (
                        <div className="mb-2 space-y-1.5 rounded-md border border-primary/40 bg-primary/5 p-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                            <Sparkles className="h-3.5 w-3.5" />
                            Cas clinique — énoncé partagé
                          </div>
                          <RichTextEditor
                            value={q.case_stem ?? ""}
                            onChange={(html) => updateCaseStem(groupKey, html)}
                            placeholder="Énoncé du cas clinique…"
                            minHeight={60}
                          />
                        </div>
                      )}
                      <div className="rounded-md border p-3 space-y-2 bg-muted/30">
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={q.keep}
                            onChange={(e) => updateItem(i, { keep: e.target.checked })}
                          />
                          <Badge variant="secondary" className="text-[10px]">
                            {q.type.toUpperCase()}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Q{i + 1} · {q.source}
                          </span>
                          {(q.course_hint || q.year_hint || q.rotation_hint) && (
                            <span className="text-[10px] text-muted-foreground/80 truncate">
                              {q.course_hint && <>· {q.course_hint} </>}
                              {q.year_hint && <>· {q.year_hint} </>}
                              {q.rotation_hint && <>· {q.rotation_hint}</>}
                            </span>
                          )}
                          {q.detection_snippet && (
                            <span
                              className="text-[10px] text-muted-foreground font-mono truncate"
                              title={q.detection_snippet}
                            >
                              source « {q.detection_snippet} »
                            </span>
                          )}
                          {q.year_detected != null &&
                            q.exam_year === "__none" &&
                            q.year_detected !== year && (
                              <Badge variant="destructive" className="text-[10px]">
                                Année détectée: {q.year_detected}
                              </Badge>
                            )}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-auto h-7 px-2 text-xs"
                            onClick={() => updateItem(i, { preview: !q.preview })}
                            title="Aperçu de la mise en forme"
                          >
                            {q.preview ? (
                              <>
                                <EyeOff className="mr-1 h-3.5 w-3.5" />
                                Éditer
                              </>
                            ) : (
                              <>
                                <Eye className="mr-1 h-3.5 w-3.5" />
                                Aperçu
                              </>
                            )}
                          </Button>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <MultiSearchableSelect
                              values={(q.rotation_ids ?? []).filter((r) => r && r !== "__none")}
                              onValuesChange={(vals) => {
                                const primary = primaryRotation(vals, rotations);
                                updateItem(i, {
                                  rotation_ids: vals,
                                  rotation_id: primary ?? "__none",
                                });
                              }}
                              options={rotationMultiOptions(rotations)}
                              placeholder="Rotations (Pn)"
                              searchPlaceholder="Rechercher une rotation…"
                              triggerClassName="h-8"
                            />
                            {(q.rotation_ids ?? []).some((r) => r && r !== "__none") && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs text-destructive"
                                onClick={() =>
                                  updateItem(i, {
                                    rotation_ids: [],
                                    rotation_id: "__none",
                                    rotation_hint: null,
                                    rotation_hints: null,
                                  })
                                }
                              >
                                <X className="mr-1 h-3 w-3" />
                                Retirer toutes les rotations
                              </Button>
                            )}
                          </div>
                          <div className="space-y-1">
                            <MultiSearchableSelect
                              values={q.exam_years ?? []}
                              onValuesChange={(vals) => {
                                const latest = latestYear(vals);
                                updateItem(i, {
                                  exam_years: vals,
                                  exam_year: latest != null ? String(latest) : "__none",
                                });
                              }}
                              options={yearMultiOptions(tr, year)}
                              placeholder="Années (la plus récente affichée)"
                              searchPlaceholder="Rechercher une année…"
                              triggerClassName="h-8"
                            />
                            {(q.exam_years ?? []).length > 0 && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-1.5 text-xs text-destructive"
                                onClick={() =>
                                  updateItem(i, {
                                    exam_years: [],
                                    exam_year: "__none",
                                    year_hint: null,
                                    year_hints: null,
                                    year_detected: null,
                                  })
                                }
                              >
                                <X className="mr-1 h-3 w-3" />
                                Retirer toutes les années
                              </Button>
                            )}
                          </div>
                          <SearchableSelect
                            value={q.folder_id}
                            onValueChange={(v) => updateItem(i, { folder_id: v })}
                            options={folderOptions(tr, folders, "— cours —")}
                            placeholder="Cours / dossier"
                            triggerClassName="h-8"
                          />
                        </div>
                        {q.preview ? (
                          <div className="min-w-0 rounded-md border bg-background p-3 space-y-3">
                            <div className="min-w-0">
                              <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                Énoncé
                              </div>
                              <RichText
                                html={q.stem}
                                className="prose prose-sm max-w-none dark:prose-invert break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto"
                              />
                            </div>
                            {q.type !== "qroc" && q.choices && q.choices.length > 0 && (
                              <div className="min-w-0">
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Propositions
                                </div>
                                <ol className="list-none space-y-1">
                                  {q.choices.map((c, k) => {
                                    const isCorrect = (q.correct_indices ?? []).includes(k);
                                    return (
                                      <li
                                        key={k}
                                        className={`flex min-w-0 gap-2 rounded px-2 py-1 text-sm ${isCorrect ? "bg-emerald-500/10 ring-1 ring-emerald-500/30" : ""}`}
                                      >
                                        <span className="font-mono text-xs text-muted-foreground pt-0.5 shrink-0">
                                          {String.fromCharCode(65 + k)}.
                                        </span>
                                        <RichText
                                          html={c}
                                          className="prose prose-sm max-w-none dark:prose-invert min-w-0 flex-1 break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto"
                                        />
                                      </li>
                                    );
                                  })}
                                </ol>
                              </div>
                            )}
                            {q.type === "qroc" && q.model_answer && (
                              <div className="min-w-0">
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Réponse modèle
                                </div>
                                <RichText
                                  autoColor
                                  html={q.model_answer}
                                  className="prose prose-sm max-w-none dark:prose-invert break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto"
                                />
                              </div>
                            )}
                            {q.explanation && (
                              <div className="min-w-0">
                                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                                  Explication
                                </div>
                                <RichText
                                  autoColor
                                  html={q.explanation}
                                  className="prose prose-sm max-w-none dark:prose-invert break-words [&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto [&_img]:max-w-full [&_img]:h-auto"
                                />
                              </div>
                            )}
                          </div>
                        ) : (
                          <>
                            <Textarea
                              rows={2}
                              value={q.stem}
                              onChange={(e) => updateItem(i, { stem: e.target.value })}
                            />
                            {q.type !== "qroc" && q.choices && q.choices.length > 0 && (
                              <div className="space-y-1">
                                {q.choices.map((c, k) => (
                                  <div key={k} className="flex items-center gap-2 text-sm">
                                    <input
                                      type={q.type === "qcs" ? "radio" : "checkbox"}
                                      name={`c-${i}`}
                                      checked={(q.correct_indices ?? []).includes(k)}
                                      onChange={() => {
                                        const cur = new Set(q.correct_indices ?? []);
                                        if (q.type === "qcs") {
                                          cur.clear();
                                          cur.add(k);
                                        } else {
                                          cur.has(k) ? cur.delete(k) : cur.add(k);
                                        }
                                        updateItem(i, {
                                          correct_indices: [...cur].sort((a, b) => a - b),
                                        });
                                      }}
                                    />
                                    <Input
                                      value={c}
                                      onChange={(e) => {
                                        const nc = [...(q.choices ?? [])];
                                        nc[k] = e.target.value;
                                        updateItem(i, { choices: nc });
                                      }}
                                    />
                                  </div>
                                ))}
                              </div>
                            )}
                            {q.type === "qroc" && (
                              <Textarea
                                rows={2}
                                placeholder="Réponse modèle"
                                value={q.model_answer ?? ""}
                                onChange={(e) => updateItem(i, { model_answer: e.target.value })}
                              />
                            )}
                            <div className="space-y-1">
                              <Label className="text-xs">
                                Explication (mise en forme, couleurs, images)
                              </Label>
                              <RichTextEditor
                                value={q.explanation ?? ""}
                                onChange={(html) => updateItem(i, { explanation: html })}
                                placeholder="Explication (optionnel)…"
                                minHeight={80}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOpen(false);
                reset();
              }}
            >
              Annuler
            </Button>
            <Button onClick={importAll} disabled={busy || items.length === 0}>
              Importer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ImportConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        items={items}
        rotations={rotations}
        folders={folders}
        onConfirm={confirmImport}
        busy={busy}
      />
    </>
  );
}

function ImportConfirmDialog({
  open,
  onOpenChange,
  items,
  rotations,
  folders,
  onConfirm,
  busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  items: ReviewItem[];
  rotations: Rotation[];
  folders: Folder[];
  onConfirm: () => void;
  busy: boolean;
}) {
  const { tr } = useI18n();
  const kept = items.filter((i) => i.keep);
  const byType = kept.reduce<Record<string, number>>((acc, it) => {
    acc[it.type] = (acc[it.type] ?? 0) + 1;
    return acc;
  }, {});
  const missingRotation = kept.filter((i) => !i.rotation_id || i.rotation_id === "__none").length;
  const caseGroups = new Set(
    kept
      .map((i) =>
        (i.case_stem ?? "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim(),
      )
      .filter(Boolean),
  );
  const missingFolder = kept.filter((i) => !i.folder_id || i.folder_id === "__none").length;
  const missingYear = kept.filter((i) => !i.exam_year || i.exam_year === "__none").length;
  const rotCounts = new Map<string, number>();
  const folCounts = new Map<string, number>();
  kept.forEach((i) => {
    if (i.rotation_id && i.rotation_id !== "__none")
      rotCounts.set(i.rotation_id, (rotCounts.get(i.rotation_id) ?? 0) + 1);
    if (i.folder_id && i.folder_id !== "__none")
      folCounts.set(i.folder_id, (folCounts.get(i.folder_id) ?? 0) + 1);
  });
  const labelRot = (id: string) => rotations.find((r) => r.id === id)?.label ?? "Rotation";
  const labelFol = (id: string) => folders.find((f) => f.id === id)?.name ?? "Cours";
  const stripHtml = (s: string) =>
    s
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-3xl">
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer l'import</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-sm">
              <div>
                <span className="text-2xl font-semibold text-foreground">{kept.length}</span>{" "}
                <span className="text-muted-foreground">
                  question(s) seront importées sur {items.length} détectée(s).
                </span>
              </div>
              {Object.keys(byType).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(byType).map(([t, n]) => (
                    <Badge key={t} variant="secondary" className="text-[10px]">
                      {t.toUpperCase()} · {n}
                    </Badge>
                  ))}
                  {caseGroups.size > 0 && (
                    <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
                      {caseGroups.size} cas clinique(s)
                    </Badge>
                  )}
                </div>
              )}
              {(rotCounts.size > 0 || folCounts.size > 0) && (
                <div className="rounded-md border bg-muted/30 p-2 space-y-1 text-xs">
                  {rotCounts.size > 0 && (
                    <div>
                      <span className="font-medium">Rotations : </span>
                      {Array.from(rotCounts.entries())
                        .map(([id, n]) => `${labelRot(id)} (${n})`)
                        .join(", ")}
                    </div>
                  )}
                  {folCounts.size > 0 && (
                    <div>
                      <span className="font-medium">Cours : </span>
                      {Array.from(folCounts.entries())
                        .map(([id, n]) => `${labelFol(id)} (${n})`)
                        .join(", ")}
                    </div>
                  )}
                </div>
              )}
              {(missingRotation > 0 || missingFolder > 0 || missingYear > 0) && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-900 dark:text-amber-200">
                  <div className="font-medium">Champs manquants :</div>
                  <ul className="ml-4 list-disc">
                    {missingRotation > 0 && <li>{missingRotation} sans rotation</li>}
                    {missingFolder > 0 && <li>{missingFolder} sans cours</li>}
                    {missingYear > 0 && <li>{missingYear} sans année d'examen</li>}
                  </ul>
                </div>
              )}
              {kept.length > 0 && (
                <div className="rounded-md border">
                  <div className="px-2 py-1.5 text-xs font-medium bg-muted/40 border-b">
                    Aperçu de la détection ({kept.length})
                  </div>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-background border-b">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-2 py-1 w-8">#</th>
                          <th className="px-2 py-1">Question</th>
                          <th className="px-2 py-1">Rotation</th>
                          <th className="px-2 py-1">Année</th>
                          <th className="px-2 py-1">Cours</th>
                        </tr>
                      </thead>
                      <tbody>
                        {kept.map((it, i) => {
                          const stem = stripHtml(it.stem ?? "");
                          const preview = stem.length > 90 ? stem.slice(0, 90) + "…" : stem;
                          const rotIds = (it.rotation_ids ?? []).filter((r) => r && r !== "__none");
                          const allRotIds = rotIds.length
                            ? rotIds
                            : it.rotation_id && it.rotation_id !== "__none"
                              ? [it.rotation_id]
                              : [];
                          const rotResolved = allRotIds.length
                            ? allRotIds.map(labelRot).join(" · ")
                            : null;
                          const folResolved =
                            it.folder_id && it.folder_id !== "__none"
                              ? labelFol(it.folder_id)
                              : null;
                          const yearsResolved = (it.exam_years ?? [])
                            .slice()
                            .sort((a, b) => Number(b) - Number(a));
                          const yearResolved = yearsResolved.length
                            ? yearsResolved.join(" · ")
                            : it.exam_year && it.exam_year !== "__none"
                              ? it.exam_year
                              : null;
                          return (
                            <tr key={i} className="border-b last:border-0 align-top">
                              <td className="px-2 py-1 text-muted-foreground">{i + 1}</td>
                              <td className="px-2 py-1 max-w-[280px]" title={stem}>
                                {preview || (
                                  <span className="text-muted-foreground italic">(vide)</span>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                {rotResolved ? (
                                  <span className="text-foreground">{rotResolved}</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">
                                    {it.rotation_hints?.length || it.rotation_hint
                                      ? "détectée, absente du module"
                                      : "non détectée"}
                                  </span>
                                )}
                                {(it.rotation_hints?.length
                                  ? it.rotation_hints
                                  : it.rotation_hint
                                    ? [it.rotation_hint]
                                    : []
                                ).map((h, k) => (
                                  <div
                                    key={k}
                                    className="text-[10px] text-muted-foreground font-mono"
                                  >
                                    détectée « {h} »
                                  </div>
                                ))}
                                {it.detection_snippet && (
                                  <div className="text-[10px] text-muted-foreground">
                                    source « {it.detection_snippet} »
                                  </div>
                                )}
                              </td>
                              <td className="px-2 py-1">
                                {yearResolved ? (
                                  <span className="text-foreground">{yearResolved}</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">—</span>
                                )}
                                {(it.year_hints?.length
                                  ? it.year_hints
                                  : it.year_hint
                                    ? [it.year_hint]
                                    : []
                                ).map((h, k) => (
                                  <div
                                    key={k}
                                    className="text-[10px] text-muted-foreground font-mono"
                                  >
                                    détectée « {h} »
                                  </div>
                                ))}
                              </td>
                              <td className="px-2 py-1">
                                {folResolved ? (
                                  <span className="text-foreground">{folResolved}</span>
                                ) : (
                                  <span className="text-amber-600 dark:text-amber-400">—</span>
                                )}
                                {it.course_hint && (
                                  <div
                                    className="text-[10px] text-muted-foreground font-mono truncate max-w-[160px]"
                                    title={it.course_hint}
                                  >
                                    « {it.course_hint} »
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Revoir</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={busy || kept.length === 0}>
            Importer {kept.length} question(s)
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditQuestionDialog({
  question,
  rotations,
  folders,
  onSaved,
}: {
  question: Question;
  rotations: Rotation[];
  folders: Folder[];
  onSaved: () => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const isChild = !!question.parent_id;
  const [type, setType] = useState<QType>(question.type);
  const [polarity, setPolarity] = useState<QPolarity>(question.polarity);
  const initialRotationIds =
    question.rotation_ids && question.rotation_ids.length
      ? question.rotation_ids
      : question.rotation_id
        ? [question.rotation_id]
        : [];
  const [rotationIds, setRotationIds] = useState<string[]>(initialRotationIds);
  const [folderId, setFolderId] = useState(question.folder_id ?? "__none");
  const [examYears, setExamYears] = useState<string[]>(
    (question.exam_years && question.exam_years.length
      ? question.exam_years
      : question.exam_year != null
        ? [question.exam_year]
        : []
    ).map(String),
  );
  const [sessionKind, setSessionKind] = useState(question.session_kind ?? "__none");
  const [sessionNumber, setSessionNumber] = useState(
    question.session_number ? String(question.session_number) : "",
  );
  const [sessionTitle, setSessionTitle] = useState(question.session_title ?? "");
  const [stem, setStem] = useState(question.stem);
  const initialChoices: string[] = Array.isArray(question.choices)
    ? (question.choices as string[])
    : ["", "", "", ""];
  const [choices, setChoices] = useState<string[]>(
    initialChoices.length ? initialChoices : ["", "", "", ""],
  );
  const [correct, setCorrect] = useState<Set<number>>(new Set(question.correct_indices ?? []));
  const [modelAnswer, setModelAnswer] = useState(question.model_answer ?? "");
  const [explanation, setExplanation] = useState(question.explanation ?? "");
  const [busy, setBusy] = useState(false);

  const toggleCorrect = (i: number) => {
    const n = new Set(correct);
    if (type === "qcs") {
      n.clear();
      n.add(i);
    } else {
      if (n.has(i)) n.delete(i);
      else n.add(i);
    }
    setCorrect(n);
  };
  const setChoice = (i: number, v: string) => {
    const n = [...choices];
    n[i] = v;
    setChoices(n);
  };
  const addChoice = () => setChoices([...choices, ""]);
  const removeChoice = (i: number) => {
    const n = choices.filter((_, k) => k !== i);
    setChoices(n);
    const c = new Set([...correct].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
    setCorrect(c);
  };

  const save = async () => {
    if (!stem.trim()) {
      toast.error("Énoncé requis");
      return;
    }
    setBusy(true);
    try {
      const patch: any = {
        type,
        polarity,
        stem: stem.trim(),
        explanation: explanation.trim() || null,
      };
      if (!isChild) {
        patch.folder_id = folderId === "__none" ? null : folderId;
        patch.rotation_ids = rotationIds;
        patch.rotation_id = rotationIds[0] ?? null;
        patch.exam_years = examYears.map(Number).filter((n) => Number.isFinite(n));
        patch.exam_year = latestYear(examYears);
        patch.session_kind = sessionKind === "__none" ? null : sessionKind;
        patch.session_number = sessionNumber ? Number(sessionNumber) : null;
        patch.session_title = sessionTitle.trim() || null;
      }
      if (type === "qcm" || type === "qcs") {
        const filtered = choices.map((c) => c.trim()).filter(Boolean);
        if (filtered.length < 2) {
          toast.error("Au moins 2 choix");
          setBusy(false);
          return;
        }
        if (correct.size === 0) {
          toast.error("Sélectionnez la/les bonne(s) réponse(s)");
          setBusy(false);
          return;
        }
        patch.choices = filtered;
        patch.correct_indices = [...correct].sort((a, b) => a - b);
        patch.model_answer = null;
      } else if (type === "qroc") {
        if (!modelAnswer.trim()) {
          toast.error("Réponse modèle requise");
          setBusy(false);
          return;
        }
        patch.model_answer = modelAnswer.trim();
        patch.choices = null;
        patch.correct_indices = null;
      } else {
        // cas_clinique
        patch.choices = null;
        patch.correct_indices = null;
        patch.model_answer = null;
      }
      const { error } = await (supabase as any)
        .from("questions")
        .update(patch)
        .eq("id", question.id);
      if (error) throw error;
      toast.success("Question mise à jour");
      onSaved();
      setOpen(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Modifier la question</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select
                value={type}
                onValueChange={(v) => {
                  setType(v as QType);
                  setCorrect(new Set());
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["qcm", "qcs", "qroc", "cas_clinique"] as QType[]).map((t) => (
                    <SelectItem key={t} value={t} disabled={isChild && t === "cas_clinique"}>
                      {tr(QTYPE_LABEL[t])}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Polarité</Label>
              <Select value={polarity} onValueChange={(v) => setPolarity(v as QPolarity)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="correct">Cocher les réponses justes</SelectItem>
                  <SelectItem value="incorrect">Cocher les réponses fausses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {!isChild && (
              <>
                <div className="space-y-1">
                  <Label>Rotations (Pn)</Label>
                  <MultiSearchableSelect
                    values={rotationIds}
                    onValuesChange={setRotationIds}
                    options={rotations.map((r) => ({ value: r.id, label: r.label }))}
                    placeholder="Aucune rotation — cliquez pour en ajouter"
                    searchPlaceholder="Rechercher une rotation…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Années (la plus récente est affichée)</Label>
                  <MultiSearchableSelect
                    values={examYears}
                    onValuesChange={setExamYears}
                    options={yearMultiOptions(tr, question.exam_year ?? question.year)}
                    placeholder="Aucune année — cliquez pour en ajouter"
                    searchPlaceholder="Rechercher une année…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Dossier</Label>
                  <SearchableSelect
                    value={folderId}
                    onValueChange={setFolderId}
                    options={folderOptions(tr, folders, "—")}
                    placeholder="Rechercher un cours…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Type de séance</Label>
                  <Select value={sessionKind} onValueChange={setSessionKind}>
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      <SelectItem value="cours">Cours</SelectItem>
                      <SelectItem value="td">TD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Numéro</Label>
                  <Input
                    type="number"
                    min="1"
                    value={sessionNumber}
                    onChange={(e) => setSessionNumber(e.target.value)}
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label>Intitulé de la leçon</Label>
                  <Input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} />
                </div>
              </>
            )}
          </div>
          <div className="space-y-1">
            <Label>Énoncé</Label>
            <Textarea rows={3} value={stem} onChange={(e) => setStem(e.target.value)} />
          </div>
          {(type === "qcm" || type === "qcs") && (
            <div className="space-y-2">
              <Label>Choix (cochez {polarity === "correct" ? "les justes" : "les faux"})</Label>
              {choices.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type={type === "qcs" ? "radio" : "checkbox"}
                    checked={correct.has(i)}
                    onChange={() => toggleCorrect(i)}
                  />
                  <Input
                    value={c}
                    onChange={(e) => setChoice(i, e.target.value)}
                    placeholder={`Choix ${i + 1}`}
                  />
                  {choices.length > 2 && (
                    <Button variant="ghost" size="sm" onClick={() => removeChoice(i)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addChoice}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Ajouter un choix
              </Button>
            </div>
          )}
          {type === "qroc" && (
            <div className="space-y-1">
              <Label>Réponse modèle</Label>
              <Textarea
                rows={3}
                value={modelAnswer}
                onChange={(e) => setModelAnswer(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>Explication / correction</Label>
            <RichTextEditor
              value={explanation}
              onChange={setExplanation}
              placeholder="Explication (mise en forme, couleurs, images)…"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NewQuestionForm({
  moduleId,
  year,
  rotations,
  folders,
  onCreated,
  parentId,
  embedded,
}: {
  moduleId: string;
  year: number;
  rotations: Rotation[];
  folders: Folder[];
  onCreated: (id?: string) => void;
  parentId?: string;
  embedded?: boolean;
}) {
  const { tr } = useI18n();
  const [type, setType] = useState<QType>("qcm");
  const [polarity, setPolarity] = useState<QPolarity>("correct");
  const [rotationIds, setRotationIds] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("__none");
  const [examYears, setExamYears] = useState<string[]>([]);
  const [sessionKind, setSessionKind] = useState("__none");
  const [sessionNumber, setSessionNumber] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [stem, setStem] = useState("");
  const [choices, setChoices] = useState<string[]>(["", "", "", ""]);
  const [correct, setCorrect] = useState<Set<number>>(new Set());
  const [modelAnswer, setModelAnswer] = useState("");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);

  const toggleCorrect = (i: number) => {
    const n = new Set(correct);
    if (type === "qcs") {
      n.clear();
      n.add(i);
    } else {
      if (n.has(i)) n.delete(i);
      else n.add(i);
    }
    setCorrect(n);
  };
  const setChoice = (i: number, v: string) => {
    const n = [...choices];
    n[i] = v;
    setChoices(n);
  };
  const addChoice = () => setChoices([...choices, ""]);
  const removeChoice = (i: number) => {
    const n = choices.filter((_, k) => k !== i);
    setChoices(n);
    const c = new Set([...correct].filter((x) => x !== i).map((x) => (x > i ? x - 1 : x)));
    setCorrect(c);
  };

  const submit = async () => {
    if (!stem.trim()) {
      toast.error("Énoncé requis");
      return;
    }
    setBusy(true);
    try {
      let payload: any = {
        module_id: moduleId,
        year,
        type,
        polarity,
        stem: stem.trim(),
        folder_id: folderId === "__none" ? null : folderId,
        rotation_id: rotationIds[0] ?? null,
        rotation_ids: rotationIds,
        exam_year: latestYear(examYears),
        exam_years: examYears.map(Number).filter((n) => Number.isFinite(n)),
        session_kind: sessionKind === "__none" ? null : sessionKind,
        session_number: sessionNumber ? Number(sessionNumber) : null,
        session_title: sessionTitle.trim() || null,
        explanation: explanation.trim() || null,
        parent_id: parentId ?? null,
      };
      if (type === "qcm" || type === "qcs") {
        const filtered = choices.map((c) => c.trim()).filter(Boolean);
        if (filtered.length < 2) {
          toast.error("Au moins 2 choix");
          setBusy(false);
          return;
        }
        if (correct.size === 0) {
          toast.error("Sélectionnez la/les bonne(s) réponse(s)");
          setBusy(false);
          return;
        }
        payload.choices = filtered;
        payload.correct_indices = [...correct].sort((a, b) => a - b);
      } else if (type === "qroc") {
        if (!modelAnswer.trim()) {
          toast.error("Réponse modèle requise");
          setBusy(false);
          return;
        }
        payload.model_answer = modelAnswer.trim();
      }
      const { data, error } = await (supabase as any)
        .from("questions")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      toast.success("Question ajoutée");
      if (type === "cas_clinique") {
        setCreatedCaseId((data as any).id);
        setChildOpen(true);
      } else {
        onCreated((data as any).id);
      }
      setStem("");
      setChoices(["", "", "", ""]);
      setCorrect(new Set());
      setModelAnswer("");
      setExplanation("");
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={embedded ? "space-y-3" : "rounded-lg border p-4 space-y-3 bg-muted/30"}>
      {!embedded && <div className="text-sm font-medium">Nouvelle question</div>}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Type</Label>
          <Select
            value={type}
            onValueChange={(v) => {
              setType(v as QType);
              setCorrect(new Set());
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["qcm", "qcs", "qroc", "cas_clinique"] as QType[]).map((t) => (
                <SelectItem key={t} value={t} disabled={!!parentId && t === "cas_clinique"}>
                  {tr(QTYPE_LABEL[t])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Polarité</Label>
          <Select value={polarity} onValueChange={(v) => setPolarity(v as QPolarity)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="correct">Cocher les réponses justes</SelectItem>
              <SelectItem value="incorrect">Cocher les réponses fausses</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {!parentId && (
          <>
            <div className="space-y-1">
              <Label>Rotations (Pn)</Label>
              <MultiSearchableSelect
                values={rotationIds}
                onValuesChange={setRotationIds}
                options={rotations.map((r) => ({ value: r.id, label: r.label }))}
                placeholder="Aucune rotation — cliquez pour en ajouter"
                searchPlaceholder="Rechercher une rotation…"
              />
            </div>
            <div className="space-y-1">
              <Label>Années (la plus récente est affichée)</Label>
              <MultiSearchableSelect
                values={examYears}
                onValuesChange={setExamYears}
                options={yearMultiOptions(tr, year)}
                placeholder="Aucune année — cliquez pour en ajouter"
                searchPlaceholder="Rechercher une année…"
              />
            </div>
            <div className="space-y-1">
              <Label>Dossier</Label>
              <SearchableSelect
                value={folderId}
                onValueChange={setFolderId}
                options={folderOptions(
                  tr,
                  folders.filter(
                    (f) =>
                      (f.kind as any) === "html" ||
                      (f.kind as any) === "pdf" ||
                      (f.kind as any) === "richtext",
                  ),
                  "—",
                )}
                placeholder="Rechercher un cours…"
              />
            </div>
            <div className="space-y-1">
              <Label>Type de séance</Label>
              <Select value={sessionKind} onValueChange={setSessionKind}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">—</SelectItem>
                  <SelectItem value="cours">Cours</SelectItem>
                  <SelectItem value="td">TD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Numéro</Label>
              <Input
                type="number"
                min="1"
                value={sessionNumber}
                onChange={(e) => setSessionNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Intitulé de la leçon</Label>
              <Input
                value={sessionTitle}
                onChange={(e) => setSessionTitle(e.target.value)}
                placeholder="ex: Insuffisance cardiaque"
              />
            </div>
          </>
        )}
      </div>
      <div className="space-y-1">
        <Label>Énoncé</Label>
        <Textarea rows={3} value={stem} onChange={(e) => setStem(e.target.value)} />
      </div>
      {(type === "qcm" || type === "qcs") && (
        <div className="space-y-2">
          <Label>Choix (cochez {polarity === "correct" ? "les justes" : "les faux"})</Label>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type={type === "qcs" ? "radio" : "checkbox"}
                checked={correct.has(i)}
                onChange={() => toggleCorrect(i)}
              />
              <Input
                value={c}
                onChange={(e) => setChoice(i, e.target.value)}
                placeholder={`Choix ${i + 1}`}
              />
              {choices.length > 2 && (
                <Button variant="ghost" size="sm" onClick={() => removeChoice(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addChoice}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Ajouter un choix
          </Button>
        </div>
      )}
      {type === "qroc" && (
        <div className="space-y-1">
          <Label>Réponse modèle (utilisée par l'IA pour corriger)</Label>
          <Textarea rows={3} value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label>Explication / correction</Label>
        <RichTextEditor
          value={explanation}
          onChange={setExplanation}
          placeholder="Explication (mise en forme, couleurs, images)…"
        />
      </div>
      <Button onClick={submit} disabled={busy} className="w-full">
        {busy ? "…" : parentId ? "Ajouter la sous-question" : "Créer la question"}
      </Button>
      {type === "cas_clinique" && createdCaseId && childOpen && (
        <div className="rounded-md border-2 border-dashed p-3 space-y-3">
          <div className="text-sm font-medium">Sous-questions du cas clinique</div>
          <NewQuestionForm
            moduleId={moduleId}
            year={year}
            rotations={rotations}
            folders={folders}
            parentId={createdCaseId}
            embedded
            onCreated={() => {
              /* stay open, allow multiple */
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setChildOpen(false);
              setCreatedCaseId(null);
              onCreated(createdCaseId);
            }}
          >
            Terminer le cas
          </Button>
        </div>
      )}
    </div>
  );
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
type NewModuleRow = { title: string; slug: string; description: string; slugTouched: boolean };
const emptyRow = (): NewModuleRow => ({ title: "", slug: "", description: "", slugTouched: false });

function NewModuleForm({ onCreated }: { onCreated: () => void }) {
  const { tr } = useI18n();
  const [year, setYear] = useState("1");
  const [rows, setRows] = useState<NewModuleRow[]>([emptyRow()]);
  const [bulk, setBulk] = useState("");
  const [showBulk, setShowBulk] = useState(false);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<NewModuleRow>) => {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };
  const onTitle = (i: number, v: string) => {
    setRows((rs) =>
      rs.map((r, idx) => {
        if (idx !== i) return r;
        return { ...r, title: v, slug: r.slugTouched ? r.slug : slugify(v) };
      }),
    );
  };
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length <= 1 ? rs : rs.filter((_, idx) => idx !== i)));
  const appendFromBulk = () => {
    const lines = bulk
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return;
    setRows((rs) => {
      const base = rs.length === 1 && !rs[0].title.trim() && !rs[0].slug.trim() ? [] : rs;
      return [
        ...base,
        ...lines.map((t) => ({ title: t, slug: slugify(t), description: "", slugTouched: false })),
      ];
    });
    setBulk("");
    setShowBulk(false);
  };

  const valid = rows.filter((r) => r.title.trim() || r.slug.trim());
  const create = async () => {
    if (!valid.length) {
      toast.error("Ajoutez au moins un module");
      return;
    }
    for (const r of valid) {
      if (!r.title.trim() || !r.slug.trim()) {
        toast.error("Titre et slug requis pour chaque module");
        return;
      }
    }
    const slugs = valid.map((r) => r.slug.trim());
    if (new Set(slugs).size !== slugs.length) {
      toast.error("Slugs en double dans la liste");
      return;
    }
    setBusy(true);
    const payload = valid.map((r) => ({
      title: r.title.trim(),
      slug: r.slug.trim(),
      year: Number(year),
      description: r.description.trim() || null,
    }));
    const { error } = await supabase.from("modules").insert(payload);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`${payload.length} module(s) créé(s)`);
    setRows([emptyRow()]);
    onCreated();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Nouveaux modules</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Année (partagée)</Label>
          <Select value={year} onValueChange={setYear}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5, 6].map((y) => (
                <SelectItem key={y} value={String(y)}>
                  Année {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Module {i + 1}</span>
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => removeRow(i)}
                    aria-label="Retirer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <div className="space-y-1">
                <Label>Titre</Label>
                <Input value={r.title} onChange={(e) => onTitle(i, e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Slug</Label>
                <Input
                  value={r.slug}
                  placeholder="ex: cardiologie"
                  onChange={(e) =>
                    update(i, {
                      slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
                      slugTouched: true,
                    })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>Description</Label>
                <Textarea
                  rows={2}
                  value={r.description}
                  onChange={(e) => update(i, { description: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>

        <Button variant="outline" size="sm" onClick={addRow} className="w-full">
          <Plus className="mr-1.5 h-4 w-4" />
          Ajouter un module
        </Button>

        <div className="space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowBulk((v) => !v)}
            className="w-full"
          >
            {showBulk ? "Masquer" : "Coller une liste (un titre par ligne)"}
          </Button>
          {showBulk && (
            <div className="space-y-2">
              <Textarea
                rows={5}
                value={bulk}
                onChange={(e) => setBulk(e.target.value)}
                placeholder={"Cardiologie\nPneumologie\nGastro-entérologie"}
              />
              <Button size="sm" variant="secondary" onClick={appendFromBulk} className="w-full">
                Ajouter à la liste
              </Button>
            </div>
          )}
        </div>

        <Button onClick={create} disabled={busy || !valid.length} className="w-full">
          <Plus className="mr-1.5 h-4 w-4" />
          {busy ? "…" : `Créer ${valid.length || ""} module${valid.length > 1 ? "s" : ""}`.trim()}
        </Button>
      </CardContent>
    </Card>
  );
}

function ModuleEditor({
  module: m,
  contents,
  onModuleChanged,
  onModuleDeleted,
  onContentsChanged,
}: {
  module: Module;
  contents: Content[];
  onModuleChanged: () => void;
  onModuleDeleted: () => void;
  onContentsChanged: () => void;
}) {
  const { tr } = useI18n();
  const { isSuper, has } = useAdminPermissions();
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null));
  }, []);
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description ?? "");
  const [year, setYear] = useState(String(m.year));
  const [icon, setIcon] = useState(m.icon ?? "");
  const [color, setColor] = useState(m.color ?? "");
  const [folders, setFolders] = useState<Folder[]>([]);
  const [rotations, setRotations] = useState<Rotation[]>([]);

  const loadFolders = async () => {
    const { data } = await supabase
      .from("module_folders")
      .select("*")
      .eq("module_id", m.id)
      .order("kind")
      .order("sort_order");
    setFolders((data as Folder[]) ?? []);
  };
  const loadRotations = async () => {
    const { data } = await supabase
      .from("module_rotations")
      .select("*")
      .eq("module_id", m.id)
      .order("sort_order");
    setRotations((data as Rotation[]) ?? []);
  };
  useEffect(() => {
    loadFolders();
    loadRotations();
  }, [m.id]);

  useEffect(() => {
    setTitle(m.title);
    setDescription(m.description ?? "");
    setYear(String(m.year));
    setIcon(m.icon ?? "");
    setColor(m.color ?? "");
  }, [m.id]);

  const save = async () => {
    const { error } = await supabase
      .from("modules")
      .update({
        title: title.trim(),
        description: description.trim() || null,
        year: Number(year),
        icon: icon || null,
        color: color || null,
      })
      .eq("id", m.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Module mis à jour");
      onModuleChanged();
    }
  };

  const remove = async () => {
    const { error } = await supabase.from("modules").delete().eq("id", m.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Supprimé");
      onModuleDeleted();
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Paramètres du module</CardTitle>
          {isSuper && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 className="mr-1.5 h-4 w-4" />
                  Supprimer
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Supprimer le module ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action est irréversible. Le module « {m.title} » et tous ses contenus
                    seront définitivement supprimés.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={remove}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Supprimer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Titre</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Année</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      Année {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Icône (emoji)</Label>
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                maxLength={4}
                placeholder="🩺"
              />
            </div>
            <div className="space-y-1">
              <Label>Couleur d'accent</Label>
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#fde68a"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <Button onClick={save}>Enregistrer</Button>
        </CardContent>
      </Card>

      <RotationsPanel
        moduleId={m.id}
        rotations={rotations}
        canManage={isSuper || has("manage_modules")}
        isSuper={isSuper}
        uid={uid}
        onChanged={loadRotations}
      />

      <FoldersPanel
        moduleId={m.id}
        folders={folders}
        contents={contents}
        canManageContent={isSuper || has("manage_content")}
        canManageQuiz={isSuper || has("manage_quiz")}
        isSuper={isSuper}
        uid={uid}
        onChanged={loadFolders}
        onContentsChanged={onContentsChanged}
      />

      <QuestionsPanel
        moduleId={m.id}
        year={m.year}
        rotations={rotations}
        folders={folders}
        canManage={isSuper || has("manage_quiz")}
        isSuper={isSuper}
        uid={uid}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contenus</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {contents.length === 0 && (
              <p className="text-sm text-muted-foreground">Aucun contenu.</p>
            )}
            {contents.map((c) => {
              const canDelete = isSuper || (uid !== null && c.created_by === uid);
              const canEditContent = isSuper || has("manage_content");
              const removeContent = async () => {
                if (c.file_path) await supabase.storage.from("module-files").remove([c.file_path]);
                const { error } = await supabase.from("module_contents").delete().eq("id", c.id);
                if (error) toast.error(error.message);
                else {
                  toast.success("Supprimé");
                  onContentsChanged();
                }
              };
              return (
                <div
                  key={c.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div>
                    <div className="font-medium">{c.title}</div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-1.5 items-center">
                      <span>{tr(KIND_LABEL[c.kind])}</span>
                      {c.folder_id && (
                        <Badge variant="secondary" className="text-[10px]">
                          {folders.find((f) => f.id === c.folder_id)?.name ?? "Dossier"}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button asChild variant="ghost" size="sm">
                      <Link
                        to="/modules/$moduleId/$contentId"
                        params={{ moduleId: m.id, contentId: c.id }}
                        target="_blank"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </Button>
                    {canEditContent && c.kind === "html" && c.file_path && (
                      <EditHtmlContentDialog content={c} onSaved={onContentsChanged} />
                    )}
                    {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm" className="text-destructive">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer ce contenu ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Cette action est irréversible. « {c.title} » sera définitivement
                              supprimé{c.file_path ? ", ainsi que son fichier associé" : ""}.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={removeContent}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Supprimer
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <NewContentForm
            moduleId={m.id}
            folders={folders}
            rotations={rotations}
            onCreated={onContentsChanged}
          />
          <div className="pt-2">
            <BundleImport defaultModuleId={m.id} onImported={onContentsChanged} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EditHtmlContentDialog({ content, onSaved }: { content: Content; onSaved: () => void }) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [text, setText] = useState("");

  const load = async () => {
    if (!content.file_path) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.storage
        .from("module-files")
        .download(content.file_path);
      if (error) throw error;
      setText(await data.text());
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!content.file_path) return;
    setSaving(true);
    try {
      const { error } = await supabase.storage
        .from("module-files")
        .upload(content.file_path, new Blob([text], { type: "text/html" }), {
          upsert: true,
          contentType: "text/html",
        });
      if (error) throw error;
      toast.success(tr("Fichier enregistré"));
      setOpen(false);
      onSaved();
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Pencil className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>
            {tr("Modifier")} — {content.title}
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">…</p>
        ) : (
          <Textarea
            rows={20}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="font-mono text-xs"
            spellCheck={false}
          />
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
            {tr("Annuler")}
          </Button>
          <Button onClick={save} disabled={saving || loading}>
            {saving ? tr("Enregistrement...") : tr("Enregistrer")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RotationsPanel({
  moduleId,
  rotations,
  canManage,
  isSuper,
  uid,
  onChanged,
}: {
  moduleId: string;
  rotations: Rotation[];
  canManage: boolean;
  isSuper: boolean;
  uid: string | null;
  onChanged: () => void;
}) {
  const { tr } = useI18n();
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();
  const [label, setLabel] = useState("");
  const currentYear = new Date().getFullYear();
  const [genFromYear, setGenFromYear] = useState<string>(String(currentYear - 2));
  const [genToYear, setGenToYear] = useState<string>(String(currentYear));
  const [genPerYear, setGenPerYear] = useState<string>("4");
  const [genIncludeRattrapage, setGenIncludeRattrapage] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [rattrapageFromYear, setRattrapageFromYear] = useState<string>(String(currentYear - 2));
  const [rattrapageToYear, setRattrapageToYear] = useState<string>(String(currentYear));
  const [rattrapageBusy, setRattrapageBusy] = useState(false);
  const add = async () => {
    const v = label.trim();
    if (!v) return;
    const next = (rotations[rotations.length - 1]?.sort_order ?? 0) + 1;
    const { error } = await supabase
      .from("module_rotations")
      .insert({ module_id: moduleId, label: v, sort_order: next });
    if (error) toast.error(error.message);
    else {
      setLabel("");
      toast.success("Rotation ajoutée");
      onChanged();
    }
  };
  const autoGenerate = async () => {
    const fromY = parseInt(genFromYear, 10);
    const toY = parseInt(genToYear, 10);
    const perY = parseInt(genPerYear, 10);
    if (!Number.isFinite(fromY) || !Number.isFinite(toY) || !Number.isFinite(perY)) {
      toast.error("Valeurs invalides");
      return;
    }
    if (fromY > toY) {
      toast.error("Année de début > année de fin");
      return;
    }
    if (perY < 1 || perY > 20) {
      toast.error("P par année entre 1 et 20");
      return;
    }
    if (toY - fromY > 20) {
      toast.error("Plage d'années trop large");
      return;
    }
    const existing = new Set(rotations.map((r) => r.label.toLowerCase()));
    const rows: { module_id: string; label: string; sort_order: number }[] = [];
    let next = (rotations[rotations.length - 1]?.sort_order ?? 0) + 1;
    for (let y = fromY; y <= toY; y++) {
      for (let p = 1; p <= perY; p++) {
        const lbl = `P${p} ${y}`;
        if (existing.has(lbl.toLowerCase())) continue;
        rows.push({ module_id: moduleId, label: lbl, sort_order: next++ });
      }
      if (genIncludeRattrapage) {
        const lbl = `Rattrapage ${y}`;
        if (!existing.has(lbl.toLowerCase()))
          rows.push({ module_id: moduleId, label: lbl, sort_order: next++ });
      }
    }
    if (rows.length === 0) {
      toast.info("Toutes les rotations existent déjà");
      return;
    }
    if (!(await confirm(`Générer ${rows.length} rotation(s) ?`))) return;
    setGenBusy(true);
    const { error } = await supabase.from("module_rotations").insert(rows);
    setGenBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${rows.length} rotation(s) créée(s)`);
      onChanged();
    }
  };
  const generateRattrapage = async () => {
    const fromY = parseInt(rattrapageFromYear, 10);
    const toY = parseInt(rattrapageToYear, 10);
    if (!Number.isFinite(fromY) || !Number.isFinite(toY)) {
      toast.error("Valeurs invalides");
      return;
    }
    if (fromY > toY) {
      toast.error("Année de début > année de fin");
      return;
    }
    if (toY - fromY > 30) {
      toast.error("Plage d'années trop large");
      return;
    }
    const existing = new Set(rotations.map((r) => r.label.toLowerCase()));
    const rows: { module_id: string; label: string; sort_order: number }[] = [];
    let next = (rotations[rotations.length - 1]?.sort_order ?? 0) + 1;
    for (let y = fromY; y <= toY; y++) {
      const lbl = `Rattrapage ${y}`;
      if (existing.has(lbl.toLowerCase())) continue;
      rows.push({ module_id: moduleId, label: lbl, sort_order: next++ });
    }
    if (rows.length === 0) {
      toast.info("Toutes les rotations existent déjà");
      return;
    }
    if (!(await confirm(`Générer ${rows.length} rotation(s) rattrapage ?`))) return;
    setRattrapageBusy(true);
    const { error } = await supabase.from("module_rotations").insert(rows);
    setRattrapageBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(`${rows.length} rotation(s) créée(s)`);
      onChanged();
    }
  };
  const rename = async (r: Rotation) => {
    const v = (await promptDialog("Nouveau nom", r.label))?.trim();
    if (!v || v === r.label) return;
    const { error } = await supabase.from("module_rotations").update({ label: v }).eq("id", r.id);
    if (error) toast.error(error.message);
    else onChanged();
  };
  const remove = async (r: Rotation) => {
    if (!(await confirm(`Supprimer la rotation « ${r.label} » ?`, { variant: "destructive" })))
      return;
    const { error } = await supabase.from("module_rotations").delete().eq("id", r.id);
    if (error) toast.error(error.message);
    else onChanged();
  };
  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/40 transition-colors flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Rotations (Pn){" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({rotations.length})
              </span>
            </CardTitle>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            {rotations.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Aucune rotation. Ajoutez P1, P2, … selon le module.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {rotations.map((r) => {
                const canDel = isSuper || (uid !== null && r.created_by === uid && canManage);
                return (
                  <div
                    key={r.id}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
                  >
                    <span className="font-medium">{r.label}</span>
                    {canManage && (
                      <button
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => rename(r)}
                      >
                        renommer
                      </button>
                    )}
                    {canDel && (
                      <button className="text-destructive" onClick={() => remove(r)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {canManage && (
              <>
                <div className="flex gap-2">
                  <Input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="ex: P1 2026"
                    className="max-w-[200px]"
                  />
                  <Button size="sm" onClick={add}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Ajouter
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Générer automatiquement
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Crée « P1 &lt;année&gt; », « P2 &lt;année&gt; », … pour chaque année de la
                    plage, avec en option « Rattrapage &lt;année&gt; ».
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <Label className="text-xs">De l'année</Label>
                      <Input
                        type="number"
                        value={genFromYear}
                        onChange={(e) => setGenFromYear(e.target.value)}
                        className="w-24"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">À l'année</Label>
                      <Input
                        type="number"
                        value={genToYear}
                        onChange={(e) => setGenToYear(e.target.value)}
                        className="w-24"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">P par année</Label>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={genPerYear}
                        onChange={(e) => setGenPerYear(e.target.value)}
                        className="w-24"
                      />
                    </div>
                    <label className="flex items-center gap-1.5 pb-2 text-xs">
                      <Checkbox
                        checked={genIncludeRattrapage}
                        onCheckedChange={(v) => setGenIncludeRattrapage(!!v)}
                      />
                      Inclure rattrapage
                    </label>
                    <Button size="sm" onClick={autoGenerate} disabled={genBusy}>
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      {genBusy ? "…" : "Générer"}
                    </Button>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Générer rattrapage par années
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Crée « Rattrapage &lt;année&gt; » pour chaque année de la plage.
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <Label className="text-xs">De l'année</Label>
                      <Input
                        type="number"
                        value={rattrapageFromYear}
                        onChange={(e) => setRattrapageFromYear(e.target.value)}
                        className="w-24"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">À l'année</Label>
                      <Input
                        type="number"
                        value={rattrapageToYear}
                        onChange={(e) => setRattrapageToYear(e.target.value)}
                        className="w-24"
                      />
                    </div>
                    <Button size="sm" onClick={generateRattrapage} disabled={rattrapageBusy}>
                      <Sparkles className="mr-1.5 h-4 w-4" />
                      {rattrapageBusy ? "…" : "Générer"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function FoldersPanel({
  moduleId,
  folders,
  contents,
  canManageContent,
  canManageQuiz,
  isSuper,
  uid,
  onChanged,
  onContentsChanged,
}: {
  moduleId: string;
  folders: Folder[];
  contents: Content[];
  canManageContent: boolean;
  canManageQuiz: boolean;
  isSuper: boolean;
  uid: string | null;
  onChanged: () => void;
  onContentsChanged: () => void;
}) {
  const { tr } = useI18n();
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();
  const [kind, setKind] = useState<Kind>("html");
  const [name, setName] = useState("");
  const [programText, setProgramText] = useState("");
  const [programBusy, setProgramBusy] = useState(false);
  const [programPreview, setProgramPreview] = useState<string[] | null>(null);
  const extractLessonsFn = useServerFn(extractLessonsFromProgram);
  const canManage = (_k: Kind) => canManageContent;
  void canManageQuiz;
  const list = folders.filter((f) => f.kind === kind);
  const add = async () => {
    const v = name.trim();
    if (!v) return;
    const next = (list[list.length - 1]?.sort_order ?? 0) + 1;
    const { error } = await supabase
      .from("module_folders")
      .insert({ module_id: moduleId, kind, name: v, sort_order: next });
    if (error) toast.error(error.message);
    else {
      setName("");
      toast.success("Dossier ajouté");
      onChanged();
    }
  };
  const rename = async (f: Folder) => {
    const v = (await promptDialog("Nouveau nom", f.name))?.trim();
    if (!v || v === f.name) return;
    const { error } = await supabase.from("module_folders").update({ name: v }).eq("id", f.id);
    if (error) toast.error(error.message);
    else onChanged();
  };
  const remove = async (f: Folder) => {
    const count = contents.filter((c) => c.folder_id === f.id).length;
    if (count > 0 && !isSuper) {
      toast.error("Le dossier n'est pas vide");
      return;
    }
    if (
      !(await confirm(
        `Supprimer le dossier « ${f.name} »${count ? ` (${count} contenus deviendront « Sans dossier »)` : ""} ?`,
        { variant: "destructive" },
      ))
    )
      return;
    const { error } = await supabase.from("module_folders").delete().eq("id", f.id);
    if (error) toast.error(error.message);
    else {
      onChanged();
      onContentsChanged();
    }
  };

  const bulkCreate = async (lessonNames: string[]) => {
    const existing = new Set(list.map((f) => f.name.trim().toLowerCase()));
    let next = (list[list.length - 1]?.sort_order ?? 0) + 1;
    const rows: { module_id: string; kind: Kind; name: string; sort_order: number }[] = [];
    for (const raw of lessonNames) {
      const v = raw.trim();
      if (!v) continue;
      if (existing.has(v.toLowerCase())) continue;
      existing.add(v.toLowerCase());
      rows.push({ module_id: moduleId, kind, name: v, sort_order: next++ });
    }
    if (rows.length === 0) {
      toast.info("Aucun nouveau dossier à créer");
      return;
    }
    if (
      !(await confirm(
        `${tr("Créer")} ${rows.length} ${tr("dossier(s) dans «")} ${tr(KIND_LABEL[kind])} » ?`,
      ))
    )
      return;
    const { error } = await supabase.from("module_folders").insert(rows);
    if (error) toast.error(error.message);
    else {
      toast.success(`${rows.length} dossier(s) créé(s)`);
      setProgramText("");
      setProgramPreview(null);
      onChanged();
    }
  };

  const importFromText = async () => {
    const lines = programText
      .split(/\r?\n/)
      .map((s) => s.replace(/^\s*[-*•\d.)]+\s*/, "").trim())
      .filter(Boolean);
    if (lines.length === 0) {
      toast.error("Aucune ligne détectée");
      return;
    }
    await bulkCreate(lines);
  };

  const importFromFile = async (file: File) => {
    setProgramBusy(true);
    setProgramPreview(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(file);
      });
      let payload: any;
      if (file.type.startsWith("image/")) payload = { kind: "image", dataUrl };
      else if (file.type === "application/pdf" || /\.pdf$/i.test(file.name))
        payload = { kind: "pdf", dataUrl, filename: file.name };
      else if (/\.docx$/i.test(file.name) || file.type.includes("wordprocessingml"))
        payload = { kind: "docx", dataUrl };
      else {
        toast.error("Format non supporté (image, PDF ou Word requis)");
        setProgramBusy(false);
        return;
      }
      const { lessons } = await extractLessonsFn({ data: payload });
      if (!lessons || lessons.length === 0) {
        toast.error("Aucun cours détecté");
        setProgramBusy(false);
        return;
      }
      setProgramPreview(lessons);
      setProgramText(lessons.join("\n"));
      toast.success(`${lessons.length} cours détecté(s) — vérifiez puis créez`);
    } catch (e: any) {
      toast.error(e?.message ?? "Extraction échouée");
    } finally {
      setProgramBusy(false);
    }
  };

  const [open, setOpen] = useState(false);
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/40 transition-colors flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">
              Dossiers{" "}
              <span className="ml-1 text-xs font-normal text-muted-foreground">
                ({folders.length})
              </span>
            </CardTitle>
            {open ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-3">
            <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <TabsList className="grid grid-cols-4 w-full">
                {(["html", "pdf", "richtext", "link"] as Kind[]).map((k) => (
                  <TabsTrigger key={k} value={k}>
                    {tr(KIND_LABEL[k])}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <div className="flex flex-wrap gap-2">
              {list.length === 0 && (
                <p className="text-sm text-muted-foreground">Aucun dossier pour cette section.</p>
              )}
              {list.map((f) => {
                const canDel =
                  isSuper || (uid !== null && f.created_by === uid && canManage(f.kind));
                const count = contents.filter((c) => c.folder_id === f.id).length;
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-sm"
                  >
                    <span className="font-medium">{f.name}</span>
                    <Badge variant="secondary" className="text-[10px]">
                      {count}
                    </Badge>
                    {canManage(f.kind) && (
                      <button
                        className="text-xs text-muted-foreground hover:underline"
                        onClick={() => rename(f)}
                      >
                        renommer
                      </button>
                    )}
                    {canDel && (
                      <button className="text-destructive" onClick={() => remove(f)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {canManage(kind) && (
              <>
                <div className="flex gap-2">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="ex: Cours 1, TD 2…"
                  />
                  <Button size="sm" onClick={add}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Ajouter
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Importer un programme
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {tr(
                      "Colle la liste des cours (un par ligne) ou importe le programme (PDF, Word, image). Les cours seront créés comme dossiers dans «",
                    )}{" "}
                    {tr(KIND_LABEL[kind])} ».
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline" disabled={programBusy}>
                      <label className="cursor-pointer">
                        <Upload className="mr-1.5 h-4 w-4" />
                        {programBusy ? "Analyse…" : "Importer un fichier"}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,application/pdf,.pdf,.docx"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) importFromFile(f);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </Button>
                    {programPreview && (
                      <Badge variant="secondary">{programPreview.length} cours détecté(s)</Badge>
                    )}
                  </div>
                  <Textarea
                    rows={5}
                    value={programText}
                    onChange={(e) => {
                      setProgramText(e.target.value);
                      setProgramPreview(null);
                    }}
                    placeholder={"Cardiologie\nPneumologie\nGastro-entérologie\n…"}
                  />
                  <div className="flex justify-end">
                    <Button size="sm" onClick={importFromText} disabled={!programText.trim()}>
                      <Plus className="mr-1.5 h-4 w-4" />
                      Créer les dossiers
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

function NewContentForm({
  moduleId,
  folders,
  rotations,
  onCreated,
}: {
  moduleId: string;
  folders: Folder[];
  rotations: Rotation[];
  onCreated: () => void;
}) {
  const { tr } = useI18n();
  void rotations;
  const [kind, setKind] = useState<Kind>("html");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [folderId, setFolderId] = useState<string>("__none");
  const folderChoices = folders.filter((f) => f.kind === kind);

  const submit = async () => {
    if (!title.trim()) {
      toast.error("Titre requis");
      return;
    }
    setBusy(true);
    try {
      let file_path: string | null = null;
      if (kind === "html" || kind === "pdf") {
        if (!file) {
          toast.error("Fichier requis");
          setBusy(false);
          return;
        }
        const ext = kind === "pdf" ? "pdf" : "html";
        const path = `${moduleId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const { error: upErr } = await supabase.storage.from("module-files").upload(path, file, {
          contentType: kind === "pdf" ? "application/pdf" : "text/html",
          upsert: false,
        });
        if (upErr) throw upErr;
        file_path = path;
        void ext;
      }
      let bodyValue: string | null = kind === "richtext" ? body : null;
      if (kind === "link") {
        const raw = url.trim();
        let parsed: URL | null = null;
        try {
          parsed = new URL(raw);
        } catch {
          /* invalid */
        }
        if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
          toast.error("URL invalide (http/https requis)");
          setBusy(false);
          return;
        }
        bodyValue = parsed.toString();
      }
      const { error } = await supabase.from("module_contents").insert({
        module_id: moduleId,
        kind,
        title: title.trim(),
        description: description.trim() || null,
        body: bodyValue,
        file_path,
        folder_id: folderId === "__none" ? null : folderId,
      });
      if (error) throw error;
      setTitle("");
      setDescription("");
      setBody("");
      setUrl("");
      setFile(null);
      toast.success("Contenu ajouté");
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="text-sm font-medium">Ajouter un cours (HTML / PDF / Notes)</div>
      <p className="text-xs text-muted-foreground">
        Les questions (QCM, QCS, QROC, cas cliniques) se gèrent dans la section « Questions »
        ci-dessous.
      </p>
      <Tabs value={kind} onValueChange={(v) => setKind(v as any)}>
        <TabsList className="grid grid-cols-4 w-full">
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="pdf">PDF</TabsTrigger>
          <TabsTrigger value="richtext">Notes</TabsTrigger>
          <TabsTrigger value="link">Lien URL</TabsTrigger>
        </TabsList>
        <div className="pt-3 space-y-3">
          <div className="space-y-1">
            <Label>Titre</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Dossier</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">Sans dossier</SelectItem>
                {folderChoices.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <TabsContent value="html" className="m-0 space-y-1">
            <Label>Fichier HTML</Label>
            <Input
              type="file"
              accept=".html,text/html"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </TabsContent>
          <TabsContent value="pdf" className="m-0 space-y-1">
            <Label>Fichier PDF</Label>
            <Input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </TabsContent>
          <TabsContent value="richtext" className="m-0 space-y-1">
            <Label>Notes</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </TabsContent>
          <TabsContent value="link" className="m-0 space-y-1">
            <Label>URL du résumé (https://…)</Label>
            <Input
              type="url"
              inputMode="url"
              placeholder="https://exemple.com/mon-resume"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Le lien s'ouvrira intégré dans la page (ou dans un nouvel onglet si le site l'exige).
            </p>
          </TabsContent>
        </div>
      </Tabs>
      <Button onClick={submit} disabled={busy} className="w-full">
        <Upload className="mr-1.5 h-4 w-4" />
        {busy ? "…" : "Ajouter"}
      </Button>
    </div>
  );
}
