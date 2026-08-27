import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RichTextEditor } from "@/components/RichTextEditor";
import { toast } from "sonner";
import { ArrowLeft, Check, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/admin/reports")({
  component: ReportsPage,
});

type QuestionType = "qcm" | "qcs" | "qroc" | "cas_clinique";
type ReportedQuestion = {
  id: string;
  stem: string;
  type: QuestionType;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  module_id: string;
};
type Report = {
  id: string;
  question_id: string;
  user_id: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  questions: ReportedQuestion | null;
};

const REASON_LABELS: Record<string, string> = {
  missing_rotation: "Rotation / année manquante",
  wrong_answer: "Mauvaise réponse",
  wrong_vocabulary: "Vocabulaire incorrect",
  other: "Autre",
};

function ReportsPage() {
  const { tr } = useI18n();
  const { loading, isSuper, has } = useAdminPermissions();
  const canManage = isSuper || has("manage_quiz") || has("manage_cases");
  const [rows, setRows] = useState<Report[]>([]);
  const [filter, setFilter] = useState<"open" | "resolved" | "rejected" | "all">("open");
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    let q = supabase
      .from("question_reports")
      .select(
        "id, question_id, user_id, reason, details, status, created_at, questions(id, stem, type, choices, correct_indices, model_answer, explanation, module_id)",
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (filter !== "all") q = q.eq("status", filter);
    const { data } = await q;
    setRows((data as unknown as Report[]) ?? []);
  };
  useEffect(() => {
    if (canManage) load(); /* eslint-disable-next-line */
  }, [canManage, filter]);

  if (loading) return null;
  if (!canManage) return <Navigate to="/admin" />;

  const setStatus = async (id: string, status: "resolved" | "rejected") => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("question_reports")
      .update({
        status,
        resolved_by: u.user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success(tr("Mis à jour"));
      load();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Admin")}
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {tr("Signalements de questions")}
          </h1>
          <div className="flex gap-1">
            {(["open", "resolved", "rejected", "all"] as const).map((f) => (
              <Button
                key={f}
                size="sm"
                variant={filter === f ? "default" : "outline"}
                onClick={() => setFilter(f)}
              >
                {f === "open"
                  ? tr("Ouverts")
                  : f === "resolved"
                    ? tr("Résolus")
                    : f === "rejected"
                      ? tr("Rejetés")
                      : tr("Tous")}
              </Button>
            ))}
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {rows.length} {rows.length > 1 ? tr("signalements") : tr("signalement")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">{tr("Rien à afficher.")}</p>
            )}
            {rows.map((r) => (
              <div key={r.id} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  <Badge variant="outline">{tr(REASON_LABELS[r.reason] ?? r.reason)}</Badge>
                  <Badge variant={r.status === "open" ? "destructive" : "secondary"}>
                    {r.status}
                  </Badge>
                  <span className="text-muted-foreground">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-sm font-medium whitespace-pre-wrap">
                  {r.questions?.stem ?? tr("(question introuvable)")}
                </div>
                {r.details && (
                  <div className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {r.details}
                  </div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {r.status === "open" && (
                    <>
                      <Button size="sm" onClick={() => setStatus(r.id, "resolved")}>
                        <Check className="h-4 w-4 mr-1" />
                        {tr("Marquer résolu")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setStatus(r.id, "rejected")}
                      >
                        <X className="h-4 w-4 mr-1" />
                        {tr("Rejeter")}
                      </Button>
                    </>
                  )}
                  {r.questions && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingId(editingId === r.id ? null : r.id)}
                    >
                      <Pencil className="h-4 w-4 mr-1" />
                      {editingId === r.id ? tr("Fermer l'édition") : tr("Modifier la question")}
                    </Button>
                  )}
                </div>
                {editingId === r.id && r.questions && (
                  <QuestionEditor
                    question={r.questions}
                    onSaved={(patch) => {
                      setRows((prev) =>
                        prev.map((row) =>
                          row.id === r.id && row.questions
                            ? { ...row, questions: { ...row.questions, ...patch } }
                            : row,
                        ),
                      );
                      setEditingId(null);
                    }}
                  />
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function QuestionEditor({
  question,
  onSaved,
}: {
  question: ReportedQuestion;
  onSaved: (patch: Partial<ReportedQuestion>) => void;
}) {
  const { tr } = useI18n();
  const [stem, setStem] = useState(question.stem);
  const [choices, setChoices] = useState<string[]>(question.choices ?? []);
  const [correct, setCorrect] = useState<number[]>(question.correct_indices ?? []);
  const [modelAnswer, setModelAnswer] = useState(question.model_answer ?? "");
  const [explanation, setExplanation] = useState(question.explanation ?? "");
  const [saving, setSaving] = useState(false);

  const isQroc = question.type === "qroc";
  const hasChoices = question.type === "qcm" || question.type === "qcs";

  const save = async () => {
    if (!stem.trim()) {
      toast.error(tr("L'énoncé est requis"));
      return;
    }
    setSaving(true);
    const patch: Partial<ReportedQuestion> = { stem };
    if (hasChoices) {
      const cleaned = choices.map((c) => c.trim()).filter(Boolean);
      patch.choices = cleaned;
      patch.correct_indices = correct.filter((i) => i < cleaned.length);
    }
    if (isQroc) patch.model_answer = modelAnswer || null;
    patch.explanation = explanation || null;
    const { error } = await supabase.from("questions").update(patch).eq("id", question.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(tr("Question mise à jour"));
    onSaved(patch);
  };

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">{tr("Énoncé")}</Label>
        <RichTextEditor value={stem} onChange={setStem} minHeight={70} />
      </div>
      {hasChoices && (
        <div className="space-y-1">
          <Label className="text-xs">{tr("Propositions (cochez les bonnes réponses)")}</Label>
          {choices.map((c, k) => (
            <div key={k} className="flex items-center gap-2">
              <input
                type={question.type === "qcs" ? "radio" : "checkbox"}
                name={`edit-${question.id}`}
                checked={correct.includes(k)}
                onChange={() => {
                  if (question.type === "qcs") setCorrect([k]);
                  else
                    setCorrect((prev) =>
                      prev.includes(k)
                        ? prev.filter((x) => x !== k)
                        : [...prev, k].sort((a, b) => a - b),
                    );
                }}
              />
              <span className="w-4 text-xs text-muted-foreground">
                {String.fromCharCode(65 + k)}
              </span>
              <Input
                value={c}
                onChange={(e) =>
                  setChoices((prev) => prev.map((x, j) => (j === k ? e.target.value : x)))
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChoices((prev) => prev.filter((_, j) => j !== k));
                  setCorrect((prev) => prev.filter((x) => x !== k).map((x) => (x > k ? x - 1 : x)));
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setChoices((prev) => [...prev, ""])}>
            <Plus className="mr-1.5 h-4 w-4" />
            {tr("Proposition")}
          </Button>
        </div>
      )}
      {isQroc && (
        <div className="space-y-1">
          <Label className="text-xs">{tr("Réponse modèle")}</Label>
          <Input value={modelAnswer} onChange={(e) => setModelAnswer(e.target.value)} />
        </div>
      )}
      <div className="space-y-1">
        <Label className="text-xs">{tr("Explication")}</Label>
        <RichTextEditor value={explanation} onChange={setExplanation} minHeight={70} />
      </div>
      <Button size="sm" onClick={save} disabled={saving}>
        <Save className="mr-1.5 h-4 w-4" />
        {saving ? tr("Enregistrement...") : tr("Enregistrer")}
      </Button>
    </div>
  );
}
