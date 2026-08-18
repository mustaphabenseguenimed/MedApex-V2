import { useEffect, useMemo, useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { CheckCircle2, ChevronDown, Eye, Flag, Loader2, Sparkles, Stethoscope, XCircle } from "lucide-react";

export type CaseQuestion = {
  id: string;
  type: "qcm" | "qcs" | "qroc" | "cas_clinique";
  polarity: "correct" | "incorrect";
  stem: string;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  parent_id: string | null;
  sort_order: number;
};

function targets(q: CaseQuestion): number[] {
  const correct = q.correct_indices ?? [];
  if (q.polarity === "correct") return correct;
  return (q.choices ?? []).map((_, i) => i).filter((i) => !correct.includes(i));
}

function isAnswered(q: CaseQuestion, answers: Record<string, any>) {
  const a = answers[q.id];
  if (q.type === "qroc") return typeof a === "string" && a.trim().length > 0;
  return Array.isArray(a) ? a.length > 0 : a != null;
}

export function CaseRunner({
  parent,
  subs,
  answers,
  grades,
  revealed,
  isExam,
  gradingId,
  flagged,
  onChoice,
  onQrocText,
  onSubmitQroc,
  onRevealAll,
  onFlag,
}: {
  parent: CaseQuestion;
  subs: CaseQuestion[];
  answers: Record<string, any>;
  grades: Record<string, { verdict: string; score: number; feedback?: string }>;
  revealed: Set<string>;
  isExam: boolean;
  gradingId: string | null;
  flagged: Set<string>;
  onChoice: (q: CaseQuestion, index: number) => void;
  onQrocText: (q: CaseQuestion, text: string) => void;
  onSubmitQroc: (q: CaseQuestion) => void;
  onRevealAll: (ids: string[]) => void;
  onFlag: (q: CaseQuestion) => void;
}) {
  const { tr } = useI18n();
  const [open, setOpen] = useState<string[]>(subs[0] ? [subs[0].id] : []);
  const [stemOpen, setStemOpen] = useState(true);

  const done = subs.length > 0 && subs.every((s) => revealed.has(s.id));
  const answeredCount = useMemo(() => subs.filter((s) => isAnswered(s, answers)).length, [subs, answers]);

  useEffect(() => {
    if (done) setOpen(subs.map((s) => s.id));
  }, [done, subs]);

  const reveal = () => {
    onRevealAll(subs.map((s) => s.id));
    setOpen(subs.map((s) => s.id));
  };

  const revealOne = (q: CaseQuestion) => {
    onRevealAll([q.id]);
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Énoncé */}
      <Card className="overflow-hidden border-primary/40 bg-muted/40">
        <button
          type="button"
          onClick={() => setStemOpen((v) => !v)}
          className="flex w-full items-center gap-2 border-b bg-primary/5 px-4 py-2.5 text-left"
        >
          <Stethoscope className="h-4 w-4 shrink-0 text-primary" />
          <span className="text-xs font-bold uppercase tracking-widest text-primary">{tr("Énoncé")}</span>
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {subs.length} {tr("questions")}
          </Badge>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition", !stemOpen && "-rotate-90")} />
        </button>
        {stemOpen && (
          <CardContent className="max-h-[45vh] overflow-y-auto px-4 py-4">
            <RichText
              html={parent.stem}
              className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed dark:prose-invert [&_img]:my-2 [&_img]:max-h-64 [&_img]:rounded-lg [&_img]:border"
            />
          </CardContent>
        )}
      </Card>

      {/* Questions */}
      <Accordion type="multiple" value={open} onValueChange={setOpen} className="space-y-2">
        {subs.map((q, i) => {
          const show = !isExam && revealed.has(q.id);
          const answered = isAnswered(q, answers);
          const target = targets(q);
          return (
            <AccordionItem
              key={q.id}
              value={q.id}
              className="overflow-hidden rounded-xl border bg-card px-0"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline">
                <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                  <span
                    className={cn(
                      "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
                      show
                        ? "bg-primary/15 text-primary"
                        : answered
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate text-sm font-semibold">
                    {tr("Question")} {i + 1}
                  </span>
                  {flagged.has(q.id) && <Flag className="h-3.5 w-3.5 shrink-0 fill-current text-amber-500" />}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-3 px-4 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">{q.type.toUpperCase()}</Badge>
                  {(q.type === "qcm" || q.type === "qcs") && (
                    <Badge variant={q.polarity === "incorrect" ? "destructive" : "secondary"} className="text-[10px]">
                      {q.polarity === "incorrect" ? tr("Cochez les MAUVAISES réponses") : tr("Cochez les BONNES réponses")}
                    </Badge>
                  )}
                  <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={() => onFlag(q)}>
                    <Flag className={cn("h-3.5 w-3.5", flagged.has(q.id) && "fill-current text-primary")} />
                  </Button>
                </div>

                <RichText
                  html={q.stem}
                  className="prose prose-sm max-w-none whitespace-pre-wrap text-sm font-medium dark:prose-invert"
                />

                {(q.type === "qcm" || q.type === "qcs") && q.choices && (
                  <div className="space-y-2">
                    {q.choices.map((ch, j) => {
                      const cur = answers[q.id];
                      const chosen = Array.isArray(cur) ? cur.includes(j) : cur === j;
                      const isTarget = target.includes(j);
                      const wrong = show && chosen && !isTarget;
                      return (
                        <button
                          key={j}
                          type="button"
                          disabled={show}
                          onClick={() => onChoice(q, j)}
                          className={cn(
                            "flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition",
                            show
                              ? isTarget
                                ? "border-emerald-500/60 bg-emerald-500/10"
                                : wrong
                                  ? "border-destructive/60 bg-destructive/10"
                                  : "border-border opacity-80"
                              : chosen
                                ? "border-primary bg-primary/10"
                                : "border-border hover:border-foreground/25 hover:bg-muted/60",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[11px] font-bold",
                              chosen && !show ? "border-primary bg-primary text-primary-foreground" : "border-border",
                            )}
                          >
                            {String.fromCharCode(65 + j)}
                          </span>
                          <span className="flex-1">{ch}</span>
                          {show && isTarget && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                          {show && wrong && <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {q.type === "qroc" && (
                  <div className="space-y-2">
                    <Textarea
                      rows={4}
                      value={answers[q.id] ?? ""}
                      onChange={(e) => onQrocText(q, e.target.value)}
                      placeholder={tr("Votre réponse…")}
                      disabled={show || !!grades[q.id]}
                    />
                    {!isExam && !grades[q.id] && (
                      <Button size="sm" variant="secondary" onClick={() => onSubmitQroc(q)} disabled={gradingId === q.id}>
                        {gradingId === q.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        {tr("Corriger avec l'IA")}
                      </Button>
                    )}
                    {grades[q.id] && (
                      <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                        <span className="font-semibold">{tr("Score : ")}</span>
                        {Math.round((grades[q.id]?.score ?? 0) * 100)}% — {grades[q.id]?.verdict}
                        {grades[q.id]?.feedback && <p className="mt-1 text-muted-foreground">{grades[q.id]?.feedback}</p>}
                      </div>
                    )}
                  </div>
                )}

                {!isExam && !show && (
                  <Button size="sm" variant="outline" onClick={() => revealOne(q)}>
                    <Eye className="mr-1.5 h-3.5 w-3.5" />
                    {tr("Voir la réponse")}
                  </Button>
                )}

                {show && (q.explanation || q.model_answer) && (
                  <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <Sparkles className="h-3.5 w-3.5" />
                      {tr("Correction")}
                    </div>
                    {q.type === "qroc" && q.model_answer && (
                      <div className="text-xs">
                        <span className="font-medium">{tr("Réponse attendue : ")}</span>
                        <span className="whitespace-pre-wrap">{q.model_answer}</span>
                      </div>
                    )}
                    {q.explanation && (
                      <RichText
                        autoColor
                        html={q.explanation}
                        className="prose prose-sm max-w-none text-sm dark:prose-invert"
                      />
                    )}
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {/* Sticky action bar */}
      {!isExam && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/90 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {answeredCount} / {subs.length} {tr("répondues")}
            </span>
            <Button onClick={reveal} disabled={done} variant="outline" className="rounded-xl font-bold">
              <Eye className="mr-2 h-4 w-4" />
              {done ? tr("Répondu") : tr("Tout révéler")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
