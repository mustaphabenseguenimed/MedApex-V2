import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, X, Package, FileArchive } from "lucide-react";
import { parseBundle, humanSize, type ParsedBundle } from "@/lib/htmlBundle";
import { useI18n } from "@/lib/i18n";

type Module = { id: string; year: number; title: string };
type Folder = { id: string; module_id: string; kind: string; name: string };

type Row = {
  key: string;
  file: File;
  parsed?: ParsedBundle;
  error?: string;
  title: string;
  year: number | null;
  moduleId: string | null;
  folderId: string | null;
  entry: string;
  status: "parsing" | "ready" | "uploading" | "done" | "error";
  progress: number;    // 0..100
  message?: string;
};

function slugify(s: string): string {
  return s.toLowerCase().replace(/\.(zip|html?|htm)$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "bundle";
}

export function BundleImport({ defaultModuleId, onImported }: { defaultModuleId?: string; onImported?: () => void }) {
  const { tr } = useI18n();
  const [modules, setModules] = useState<Module[]>([]);
  const [foldersByModule, setFoldersByModule] = useState<Record<string, Folder[]>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [defaults, setDefaults] = useState<{ year: number | null; moduleId: string | null; folderId: string | null }>({
    year: null, moduleId: defaultModuleId ?? null, folderId: null,
  });
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("modules").select("id,year,title").order("year").order("sort_order");
      const list = (data as Module[]) ?? [];
      setModules(list);
      if (defaultModuleId) {
        const m = list.find(x => x.id === defaultModuleId);
        if (m) setDefaults(d => ({ ...d, year: m.year, moduleId: m.id }));
      }
    })();
  }, [defaultModuleId]);

  const years = useMemo(() => Array.from(new Set(modules.map(m => m.year))).sort((a, b) => a - b), [modules]);
  const modulesByYear = (y: number | null) => (y == null ? [] : modules.filter(m => m.year === y));

  const ensureFolders = async (mid: string) => {
    if (foldersByModule[mid]) return foldersByModule[mid];
    const { data } = await supabase.from("module_folders").select("id,module_id,kind,name").eq("module_id", mid).eq("kind", "html").order("sort_order");
    const list = (data as Folder[]) ?? [];
    setFoldersByModule(prev => ({ ...prev, [mid]: list }));
    return list;
  };

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const nextRows: Row[] = list.map(f => ({
      key: `${f.name}-${f.size}-${f.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file: f,
      title: f.name.replace(/\.(zip|html?|htm)$/i, ""),
      year: defaults.year,
      moduleId: defaults.moduleId,
      folderId: defaults.folderId,
      entry: "",
      status: "parsing",
      progress: 0,
    }));
    setRows(prev => [...prev, ...nextRows]);
    for (const r of nextRows) {
      try {
        const parsed = await parseBundle(r.file);
        setRows(prev => prev.map(x => x.key === r.key ? { ...x, parsed, entry: parsed.suggestedEntry, status: "ready" } : x));
      } catch (e: any) {
        setRows(prev => prev.map(x => x.key === r.key ? { ...x, status: "error", error: e?.message ?? tr("Erreur d'analyse") } : x));
      }
    }
  };

  const applyDefaultsToAll = () => {
    setRows(prev => prev.map(r => ({
      ...r,
      year: defaults.year ?? r.year,
      moduleId: defaults.moduleId ?? r.moduleId,
      folderId: defaults.folderId ?? r.folderId,
    })));
    if (defaults.moduleId) void ensureFolders(defaults.moduleId);
  };

  const updateRow = (key: string, patch: Partial<Row>) => setRows(prev => prev.map(r => r.key === key ? { ...r, ...patch } : r));
  const removeRow = (key: string) => setRows(prev => prev.filter(r => r.key !== key));

  const uploadOne = async (row: Row) => {
    if (!row.parsed) throw new Error(tr("Analyse en cours"));
    if (!row.moduleId) throw new Error(tr("Module requis"));
    if (!row.entry) throw new Error(tr("Fichier d'entrée requis"));
    if (!row.title.trim()) throw new Error(tr("Titre requis"));

    const ts = Date.now();
    const prefix = `${row.moduleId}/html/${ts}-${slugify(row.file.name)}`;
    const total = row.parsed.entries.length;
    let done = 0;

    // Bounded concurrency per bundle
    const queue = [...row.parsed.entries];
    const workers = Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (queue.length) {
        const entry = queue.shift();
        if (!entry) break;
        const objectPath = `${prefix}/${entry.path}`;
        let attempt = 0;
        while (true) {
          const { error } = await supabase.storage.from("module-files").upload(objectPath, entry.blob, {
            contentType: entry.contentType, upsert: false,
          });
          if (!error) break;
          if (++attempt >= 2) throw error;
          await new Promise(r => setTimeout(r, 400));
        }
        done += 1;
        updateRow(row.key, { progress: Math.round((done / total) * 100), message: `${done}/${total}` });
      }
    });
    await Promise.all(workers);

    const filePath = `${prefix}/${row.entry}`;
    const { error: insErr } = await supabase.from("module_contents").insert({
      module_id: row.moduleId, kind: "html", title: row.title.trim(),
      description: null, body: null, file_path: filePath,
      folder_id: row.folderId,
    });
    if (insErr) throw insErr;
  };

  const uploadAll = async () => {
    const targets = rows.filter(r => r.status === "ready" || r.status === "error");
    if (targets.length === 0) return;
    setBusy(true);
    const queue = [...targets];
    const runners = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length) {
        const r = queue.shift();
        if (!r) break;
        updateRow(r.key, { status: "uploading", progress: 0, error: undefined, message: undefined });
        try {
          await uploadOne(r);
          updateRow(r.key, { status: "done", progress: 100, message: "Terminé" });
        } catch (e: any) {
          updateRow(r.key, { status: "error", error: e?.message ?? "Erreur", message: "Erreur" });
        }
      }
    });
    await Promise.all(runners);
    setBusy(false);
    if (onImported) onImported();
    const okCount = rows.filter(r => r.status === "done").length + targets.filter(r => r.status !== "error").length;
    toast.success(tr("Import terminé ({n})").replace("{n}", String(okCount)));
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter(f => /\.(zip|html?|htm)$/i.test(f.name));
    if (files.length) void addFiles(files);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><Package className="h-4 w-4" />{tr("Importer des cours HTML (ZIP)")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition ${dragOver ? "border-primary bg-accent/50" : "border-muted"}`}
        >
          <FileArchive className="mx-auto h-8 w-8 text-muted-foreground" />
          <div className="mt-2 text-sm">{tr("Glissez des fichiers")} <b>.zip</b> {tr("(ou .html) ici, ou cliquez pour parcourir.")}</div>
          <div className="text-xs text-muted-foreground">{tr("Les archives multi-fichiers (index.html + assets + sous-pages) sont extraites et servies via un lien signé.")}</div>
          <input ref={fileInput} type="file" multiple accept=".zip,.html,.htm,application/zip,text/html"
            className="hidden" onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>

        {rows.length > 0 && (
          <div className="rounded-md border p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">{tr("Valeurs par défaut (appliquées aux nouvelles lignes)")}</div>
            <div className="grid grid-cols-3 gap-2">
              <Select value={defaults.year != null ? String(defaults.year) : ""} onValueChange={(v) => setDefaults(d => ({ ...d, year: v ? Number(v) : null, moduleId: null }))}>
                <SelectTrigger className="h-8"><SelectValue placeholder={tr("Année")} /></SelectTrigger>
                <SelectContent>{years.map(y => <SelectItem key={y} value={String(y)}>{tr("Année")} {y}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={defaults.moduleId ?? ""} onValueChange={(v) => { setDefaults(d => ({ ...d, moduleId: v || null, folderId: null })); if (v) void ensureFolders(v); }}>
                <SelectTrigger className="h-8"><SelectValue placeholder={tr("Module")} /></SelectTrigger>
                <SelectContent>{modulesByYear(defaults.year).map(m => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}</SelectContent>
              </Select>
              <Select value={defaults.folderId ?? "__none"} onValueChange={(v) => setDefaults(d => ({ ...d, folderId: v === "__none" ? null : v }))}>
                <SelectTrigger className="h-8"><SelectValue placeholder={tr("Dossier")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{tr("Sans dossier")}</SelectItem>
                  {(defaults.moduleId ? foldersByModule[defaults.moduleId] ?? [] : []).map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={applyDefaultsToAll}>{tr("Appliquer à toutes les lignes")}</Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {rows.map((r) => {
            const yearOpts = years;
            const modOpts = modulesByYear(r.year);
            const folderOpts = r.moduleId ? foldersByModule[r.moduleId] ?? [] : [];
            return (
              <div key={r.key} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {humanSize(r.file.size)}
                      {r.parsed && ` · ${r.parsed.entries.length} ${tr("fichier(s)")} · ${r.parsed.htmlPaths.length} HTML`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge row={r} />
                    <Button size="icon" variant="ghost" onClick={() => removeRow(r.key)} disabled={r.status === "uploading"}><X className="h-4 w-4" /></Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{tr("Titre")}</Label>
                  <Input value={r.title} onChange={(e) => updateRow(r.key, { title: e.target.value })} disabled={r.status === "uploading" || r.status === "done"} />
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Année")}</Label>
                    <Select value={r.year != null ? String(r.year) : ""} onValueChange={(v) => updateRow(r.key, { year: v ? Number(v) : null, moduleId: null, folderId: null })}
                      disabled={r.status === "uploading" || r.status === "done"}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{yearOpts.map(y => <SelectItem key={y} value={String(y)}>{tr("Année")} {y}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Module")}</Label>
                    <Select value={r.moduleId ?? ""} onValueChange={(v) => { updateRow(r.key, { moduleId: v || null, folderId: null }); if (v) void ensureFolders(v); }}
                      disabled={r.status === "uploading" || r.status === "done" || r.year == null}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>{modOpts.map(m => <SelectItem key={m.id} value={m.id}>{m.title}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Dossier")}</Label>
                    <Select value={r.folderId ?? "__none"} onValueChange={(v) => updateRow(r.key, { folderId: v === "__none" ? null : v })}
                      disabled={r.status === "uploading" || r.status === "done" || !r.moduleId}>
                      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{tr("Sans dossier")}</SelectItem>
                        {folderOpts.map(f => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {r.parsed && r.parsed.htmlPaths.length > 1 && (
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Fichier d'entrée")}</Label>
                    <Select value={r.entry} onValueChange={(v) => updateRow(r.key, { entry: v })}
                      disabled={r.status === "uploading" || r.status === "done"}>
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {r.parsed.htmlPaths.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {(r.status === "uploading" || r.status === "done") && (
                  <div className="space-y-1">
                    <Progress value={r.progress} />
                    <div className="text-xs text-muted-foreground">{r.message ?? ""}</div>
                  </div>
                )}
                {r.status === "error" && r.error && (
                  <div className="text-xs text-destructive">{r.error}</div>
                )}
                {r.parsed && r.parsed.skipped.length > 0 && (
                  <div className="text-[11px] text-muted-foreground">{tr("Ignorés :")} {r.parsed.skipped.length} {tr("entrée(s)")}</div>
                )}
              </div>
            );
          })}
        </div>

        {rows.length > 0 && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRows([])} disabled={busy}>{tr("Vider")}</Button>
            <Button size="sm" onClick={uploadAll} disabled={busy || rows.every(r => r.status === "done")}>
              <Upload className="mr-1.5 h-4 w-4" />{busy ? tr("Import…") : tr("Tout importer")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusBadge({ row }: { row: Row }) {
  const { tr } = useI18n();
  const label =
    row.status === "parsing" ? tr("Analyse…") :
    row.status === "ready" ? tr("Prêt") :
    row.status === "uploading" ? `${tr("Upload")} ${row.progress}%` :
    row.status === "done" ? tr("Terminé") : tr("Erreur");
  const variant =
    row.status === "done" ? "default" :
    row.status === "error" ? "destructive" :
    row.status === "uploading" ? "secondary" : "outline";
  return <Badge variant={variant as any}>{label}</Badge>;
}