import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { MultiSearchableSelect } from "@/components/ui/multi-searchable-select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/RichTextEditor";
import { Plus, Stethoscope, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";

export type CaseRotation = { id: string; label: string };
export type CaseFolder = { id: string; name: string };

type SubType = "qcm" | "qcs" | "qroc";
type Sub = {
  type: SubType;
  stem: string;
  choices: string[];
  correct: number[];
  model_answer: string;
  explanation: string;
};

const emptySub = (): Sub => ({ type: "qcm", stem: "", choices: ["", "", "", "", ""], correct: [], model_answer: "", explanation: "" });

/**
 * Authoring form for a clinical case: one shared vignette plus its
 * sub-questions, all created in a single save (parent then children).
 */
export function CaseForm({ moduleId, year, rotations, folders, onCreated }: {
  moduleId: string;
  year: number;
  rotations: CaseRotation[];
  folders: CaseFolder[];
  onCreated: () => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enonce, setEnonce] = useState("");
  const [rotationIds, setRotationIds] = useState<string[]>([]);
  const [folderId, setFolderId] = useState("__none");
  const [examYears, setExamYears] = useState<string[]>([]);
  const [subs, setSubs] = useState<Sub[]>([emptySub()]);

  const now = new Date().getFullYear();
  const yearOpts: SearchableOption[] = Array.from({ length: 10 }, (_, i) => String(now + 1 - i)).map((y) => ({ value: y, label: y }));
  const folderOpts: SearchableOption[] = [{ value: "__none", label: tr("— aucun cours —") }, ...folders.map((f) => ({ value: f.id, label: f.name }))];
  const rotationOpts: SearchableOption[] = rotations.map((r) => ({ value: r.id, label: r.label }));

  const reset = () => {
    setEnonce(""); setRotationIds([]); setFolderId("__none"); setExamYears([]); setSubs([emptySub()]);
  };
  const patch = (i: number, p: Partial<Sub>) => setSubs((s) => s.map((x, k) => (k === i ? { ...x, ...p } : x)));

  const save = async () => {
    const stem = enonce.trim();
    if (!stem) { toast.error(tr("L'énoncé commun est requis")); return; }
    const valid = subs.filter((s) => s.stem.trim());
    if (!valid.length) { toast.error(tr("Ajoutez au moins une sous-question")); return; }
    setBusy(true);
    try {
      const yearsNum = examYears.map(Number).filter((n) => Number.isFinite(n));
      const shared = {
        module_id: moduleId,
        year,
        rotation_id: rotationIds.length ? rotationIds[rotationIds.length - 1] : null,
        rotation_ids: rotationIds,
        folder_id: folderId === "__none" ? null : folderId,
        exam_year: yearsNum.length ? Math.max(...yearsNum) : null,
        exam_years: yearsNum,
        polarity: "correct" as const,
      };
      const { data: maxRow } = await (supabase as any)
        .from("questions").select("sort_order").eq("module_id", moduleId)
        .order("sort_order", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const base = Number(maxRow?.sort_order ?? 0);

      const { data: parent, error: perr } = await (supabase as any)
        .from("questions")
        .insert({ ...shared, type: "cas_clinique", stem, choices: null, correct_indices: null, model_answer: null, explanation: null, parent_id: null, sort_order: base + 10 })
        .select("id").single();
      if (perr) throw perr;

      const rows = valid.map((s, i) => {
        const choices = s.choices.map((c) => c.trim()).filter(Boolean);
        const isQroc = s.type === "qroc" || choices.length === 0;
        return {
          ...shared,
          type: isQroc ? "qroc" : s.type,
          stem: s.stem,
          choices: isQroc ? null : choices,
          correct_indices: isQroc ? null : s.correct.filter((k) => k < choices.length),
          model_answer: isQroc ? s.model_answer : null,
          explanation: s.explanation || null,
          parent_id: parent.id,
          sort_order: base + (i + 2) * 10,
        };
      });
      const { error: cerr } = await (supabase as any).from("questions").insert(rows);
      if (cerr) throw cerr;

      toast.success(`${tr("Cas clinique créé")} · ${rows.length} ${tr("sous-question(s)")}`);
      reset(); setOpen(false); onCreated();
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><Stethoscope className="mr-1.5 h-4 w-4" />{tr("Cas clinique")}</Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tr("Nouveau cas clinique")}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{tr("Énoncé commun")}</Label>
            <RichTextEditor value={enonce} onChange={setEnonce} placeholder={tr("Observation clinique partagée par toutes les questions…")} minHeight={120} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">{tr("Rotation (Pn)")}</Label>
              <MultiSearchableSelect values={rotationIds} onValuesChange={setRotationIds} options={rotationOpts} placeholder={tr("Rotations…")} searchPlaceholder={tr("Rechercher…")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tr("Année d'examen")}</Label>
              <MultiSearchableSelect values={examYears} onValuesChange={setExamYears} options={yearOpts} placeholder={tr("Années…")} searchPlaceholder={tr("Rechercher…")} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{tr("Cours")}</Label>
              <SearchableSelect value={folderId} onValueChange={setFolderId} options={folderOpts} placeholder={tr("Cours…")} />
            </div>
          </div>

          <div className="space-y-3">
            {subs.map((s, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">{tr("Question")} {i + 1}</Badge>
                  <div className="flex items-center gap-2">
                    <Select value={s.type} onValueChange={(v) => patch(i, { type: v as SubType, correct: [] })}>
                      <SelectTrigger className="h-8 w-[130px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qcm">QCM</SelectItem>
                        <SelectItem value="qcs">QCS</SelectItem>
                        <SelectItem value="qroc">QROC</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" className="text-destructive" disabled={subs.length === 1}
                      onClick={() => setSubs((prev) => prev.filter((_, k) => k !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{tr("Énoncé de la question")}</Label>
                  <RichTextEditor value={s.stem} onChange={(html) => patch(i, { stem: html })} placeholder={tr("Question…")} minHeight={70} />
                </div>
                {s.type !== "qroc" ? (
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Propositions (cochez les bonnes réponses)")}</Label>
                    {s.choices.map((c, k) => (
                      <div key={k} className="flex items-center gap-2">
                        <input
                          type={s.type === "qcs" ? "radio" : "checkbox"}
                          name={`case-sub-${i}`}
                          checked={s.correct.includes(k)}
                          onChange={() => {
                            if (s.type === "qcs") patch(i, { correct: [k] });
                            else patch(i, { correct: s.correct.includes(k) ? s.correct.filter((x) => x !== k) : [...s.correct, k].sort((a, b) => a - b) });
                          }}
                        />
                        <span className="w-4 text-xs text-muted-foreground">{String.fromCharCode(65 + k)}</span>
                        <Input value={c} onChange={(e) => patch(i, { choices: s.choices.map((x, j) => (j === k ? e.target.value : x)) })} placeholder={tr("Proposition")} />
                        <Button variant="ghost" size="sm" onClick={() => patch(i, { choices: s.choices.filter((_, j) => j !== k), correct: s.correct.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                    <Button variant="outline" size="sm" onClick={() => patch(i, { choices: [...s.choices, ""] })}>
                      <Plus className="mr-1.5 h-4 w-4" />{tr("Proposition")}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label className="text-xs">{tr("Réponse modèle")}</Label>
                    <Input value={s.model_answer} onChange={(e) => patch(i, { model_answer: e.target.value })} />
                  </div>
                )}
                <div className="space-y-1">
                  <Label className="text-xs">{tr("Explication")}</Label>
                  <RichTextEditor value={s.explanation} onChange={(html) => patch(i, { explanation: html })} placeholder={tr("Explication (optionnel)…")} minHeight={80} />
                </div>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setSubs((s) => [...s, emptySub()])}>
              <Plus className="mr-1.5 h-4 w-4" />{tr("Ajouter une sous-question")}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>{tr("Annuler")}</Button>
          <Button onClick={save} disabled={busy}>{busy ? "…" : tr("Créer le cas")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}