import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listDueFlashcards, reviewFlashcard, deleteFlashcard } from "@/lib/flashcards.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import { useActiveElapsed } from "@/lib/useActiveElapsed";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Eye, Timer, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/flashcards")({
  head: () => ({
    meta: [
      { title: "Flashcards — Med Apex" },
      { name: "description", content: "Review your flashcards with spaced repetition." },
    ],
  }),
  component: () => (
    <AnyScopeGate scope="sessions">
      <FlashcardsRunner />
    </AnyScopeGate>
  ),
});

type LinkedQuestion = {
  id: string;
  type: "qcm" | "qcs" | "qroc" | "cas_clinique";
  stem: string;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  polarity: "correct" | "incorrect";
  parent_id: string | null;
} | null;

type Card = {
  id: string;
  front: string;
  back: string;
  question_id: string | null;
  tags: string[];
  questions: LinkedQuestion;
  case_stem: string | null;
};

/** Choice indices the reviewer should have picked, mirroring CaseRunner's targets(). */
function targetIndices(q: LinkedQuestion): number[] {
  if (!q) return [];
  const correct = q.correct_indices ?? [];
  if (q.polarity === "correct") return correct;
  return (q.choices ?? []).map((_, i) => i).filter((i) => !correct.includes(i));
}

function FlashcardsRunner() {
  const { t, tr } = useI18n();
  const load = useServerFn(listDueFlashcards);
  const review = useServerFn(reviewFlashcard);
  const del = useServerFn(deleteFlashcard);
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const { seconds: elapsed } = useActiveElapsed();

  useEffect(() => {
    (async () => setCards((await load()) as Card[]))();
  }, [load]);

  const current = cards[idx];

  async function grade(g: 1 | 3 | 4 | 5) {
    if (!current) return;
    try {
      await review({ data: { id: current.id, grade: g } });
      const key = g === 1 ? "again" : g === 3 ? "hard" : g === 4 ? "good" : "easy";
      setDone((d) => ({ ...d, [key]: d[key as keyof typeof d] + 1 }));
      setRevealed(false);
      setIdx((i) => i + 1);
    } catch (e: any) {
      toast.error(e.message ?? t("error"));
    }
  }

  async function removeCard() {
    if (!current) return;
    try {
      await del({ data: { id: current.id } });
      setCards((cs) => cs.filter((c) => c.id !== current.id));
      setRevealed(false);
      toast.success(t("card_deleted"));
    } catch (e: any) {
      toast.error(e.message ?? t("error"));
    }
  }

  if (cards.length > 0 && idx >= cards.length) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b">
          <div className="mx-auto max-w-2xl px-6 py-4">
            <Button asChild variant="ghost" size="sm">
              <Link to="/questions">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {t("questions")}
              </Link>
            </Button>
          </div>
        </header>
        <main className="mx-auto max-w-2xl px-6 py-16 text-center space-y-4">
          <h1 className="text-3xl font-semibold">{t("session_done")}</h1>
          <p className="text-muted-foreground">
            {t("bravo")} — {cards.length} {t("cards_reviewed")}.
          </p>
          <div className="mx-auto flex w-fit items-center gap-1.5 rounded-full border px-3 py-1 font-mono text-sm text-muted-foreground">
            <Timer className="h-4 w-4" />
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
          </div>
          <div className="flex justify-center gap-3 text-sm">
            <Badge variant="destructive">
              {t("again")}: {done.again}
            </Badge>
            <Badge variant="outline">
              {t("hard")}: {done.hard}
            </Badge>
            <Badge variant="secondary">
              {t("good")}: {done.good}
            </Badge>
            <Badge>
              {t("easy")}: {done.easy}
            </Badge>
          </div>
          <Button asChild>
            <Link to="/questions">{t("back")}</Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/questions">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("questions")}
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5 font-mono">
              <Timer className="h-4 w-4" />
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </div>
            <div>
              {Math.min(idx + 1, cards.length)} / {cards.length}
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-6 py-10 space-y-4">
        {!current ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              {t("no_due_cards")}
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardContent className="min-h-[220px] space-y-3 py-8">
                {current.questions ? (
                  <>
                    {current.case_stem && (
                      <div className="rounded-lg border border-primary/40 bg-muted/40 p-3">
                        <RichText
                          html={current.case_stem}
                          className="prose prose-sm max-w-none text-sm dark:prose-invert"
                        />
                      </div>
                    )}
                    <RichText
                      html={current.questions.stem}
                      className="prose prose-sm max-w-none text-lg font-medium dark:prose-invert"
                    />
                    {(current.questions.type === "qcm" || current.questions.type === "qcs") &&
                      current.questions.choices && (
                        <div className="space-y-2 pt-1">
                          {current.questions.choices.map((ch, j) => {
                            const isTarget =
                              revealed && targetIndices(current.questions).includes(j);
                            return (
                              <div
                                key={j}
                                className={cn(
                                  "flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm",
                                  isTarget
                                    ? "border-emerald-500/60 bg-emerald-500/10"
                                    : "border-border",
                                )}
                              >
                                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-border text-[11px] font-bold">
                                  {String.fromCharCode(65 + j)}
                                </span>
                                <span className="flex-1">{ch}</span>
                                {isTarget && (
                                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </>
                ) : (
                  <div className="whitespace-pre-wrap text-lg">{current.front}</div>
                )}
              </CardContent>
            </Card>
            {revealed ? (
              <>
                <Card className="border-primary/40 bg-accent/30">
                  <CardContent className="space-y-2 py-6 text-sm">
                    {current.questions ? (
                      <>
                        {current.questions.type === "qroc" && current.questions.model_answer && (
                          <div>
                            <span className="font-medium">{tr("Réponse attendue : ")}</span>
                            <span className="whitespace-pre-wrap">
                              {current.questions.model_answer}
                            </span>
                          </div>
                        )}
                        {current.questions.explanation ? (
                          <RichText
                            autoColor
                            html={current.questions.explanation}
                            className="prose prose-sm max-w-none dark:prose-invert"
                          />
                        ) : (
                          !current.questions.model_answer && (
                            <span className="italic text-muted-foreground">
                              {t("no_answer_saved")}
                            </span>
                          )
                        )}
                      </>
                    ) : (
                      <div className="whitespace-pre-wrap">
                        {current.back || (
                          <span className="text-muted-foreground italic">
                            {t("no_answer_saved")}
                          </span>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
                <div className="grid grid-cols-4 gap-2">
                  <Button variant="destructive" onClick={() => grade(1)}>
                    {t("again")}
                    <span className="ml-1 text-xs opacity-70">&lt;1j</span>
                  </Button>
                  <Button variant="outline" onClick={() => grade(3)}>
                    {t("hard")}
                  </Button>
                  <Button variant="secondary" onClick={() => grade(4)}>
                    {t("good")}
                  </Button>
                  <Button onClick={() => grade(5)}>{t("easy")}</Button>
                </div>
                <div className="flex justify-between pt-2">
                  {current.question_id ? (
                    <span className="text-xs text-muted-foreground">{t("from_question")}</span>
                  ) : (
                    <span />
                  )}
                  <Button size="sm" variant="ghost" onClick={removeCard}>
                    <Trash2 className="h-4 w-4 mr-1" />
                    {t("delete")}
                  </Button>
                </div>
              </>
            ) : (
              <Button className="w-full" onClick={() => setRevealed(true)}>
                <Eye className="mr-1.5 h-4 w-4" />
                {t("reveal")}
              </Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
