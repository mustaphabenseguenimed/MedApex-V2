import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { listDueFlashcards, reviewFlashcard, deleteFlashcard } from "@/lib/flashcards.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Eye, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { AnyScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/questions/flashcards")({
  head: () => ({
    meta: [
      { title: "Flashcards — Med Apex" },
      { name: "description", content: "Review your flashcards with spaced repetition." },
    ],
  }),
  component: () => <AnyScopeGate scope="sessions"><FlashcardsRunner /></AnyScopeGate>,
});

type Card = {
  id: string;
  front: string;
  back: string;
  question_id: string | null;
  tags: string[];
};

function FlashcardsRunner() {
  const { t } = useI18n();
  const load = useServerFn(listDueFlashcards);
  const review = useServerFn(reviewFlashcard);
  const del = useServerFn(deleteFlashcard);
  const [cards, setCards] = useState<Card[]>([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState({ again: 0, hard: 0, good: 0, easy: 0 });

  useEffect(() => { (async () => setCards((await load()) as Card[]))(); }, [load]);

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
    } catch (e: any) { toast.error(e.message ?? t("error")); }
  }

  if (cards.length > 0 && idx >= cards.length) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b"><div className="mx-auto max-w-2xl px-6 py-4">
          <Button asChild variant="ghost" size="sm"><Link to="/questions"><ArrowLeft className="mr-1.5 h-4 w-4" />{t("questions")}</Link></Button>
        </div></header>
        <main className="mx-auto max-w-2xl px-6 py-16 text-center space-y-4">
          <h1 className="text-3xl font-semibold">{t("session_done")}</h1>
          <p className="text-muted-foreground">{t("bravo")} — {cards.length} {t("cards_reviewed")}.</p>
          <div className="flex justify-center gap-3 text-sm">
            <Badge variant="destructive">{t("again")}: {done.again}</Badge>
            <Badge variant="outline">{t("hard")}: {done.hard}</Badge>
            <Badge variant="secondary">{t("good")}: {done.good}</Badge>
            <Badge>{t("easy")}: {done.easy}</Badge>
          </div>
          <Button asChild><Link to="/questions">{t("back")}</Link></Button>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-2xl px-6 py-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm"><Link to="/questions"><ArrowLeft className="mr-1.5 h-4 w-4" />{t("questions")}</Link></Button>
        <div className="text-sm text-muted-foreground">{Math.min(idx + 1, cards.length)} / {cards.length}</div>
      </div></header>
      <main className="mx-auto max-w-2xl px-6 py-10 space-y-4">
        {!current ? (
          <Card><CardContent className="py-16 text-center text-muted-foreground">
            {t("no_due_cards")}
          </CardContent></Card>
        ) : (
          <>
            <Card>
              <CardContent className="min-h-[220px] py-8 whitespace-pre-wrap text-lg">
                {current.front}
              </CardContent>
            </Card>
            {revealed ? (
              <>
                <Card className="border-primary/40 bg-accent/30">
                  <CardContent className="py-6 whitespace-pre-wrap text-sm">{current.back || <span className="text-muted-foreground italic">{t("no_answer_saved")}</span>}</CardContent>
                </Card>
                <div className="grid grid-cols-4 gap-2">
                  <Button variant="destructive" onClick={() => grade(1)}>{t("again")}<span className="ml-1 text-xs opacity-70">&lt;1j</span></Button>
                  <Button variant="outline" onClick={() => grade(3)}>{t("hard")}</Button>
                  <Button variant="secondary" onClick={() => grade(4)}>{t("good")}</Button>
                  <Button onClick={() => grade(5)}>{t("easy")}</Button>
                </div>
                <div className="flex justify-between pt-2">
                  {current.question_id ? (
                    <span className="text-xs text-muted-foreground">{t("from_question")}</span>
                  ) : <span />}
                  <Button size="sm" variant="ghost" onClick={removeCard}><Trash2 className="h-4 w-4 mr-1" />{t("delete")}</Button>
                </div>
              </>
            ) : (
              <Button className="w-full" onClick={() => setRevealed(true)}><Eye className="mr-1.5 h-4 w-4" />{t("reveal")}</Button>
            )}
          </>
        )}
      </main>
    </div>
  );
}
