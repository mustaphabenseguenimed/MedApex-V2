import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { gradeQrocAnswer } from "@/lib/questions.functions";
import { toggleFlag, upsertNote, submitReview } from "@/lib/sessions.functions";
import {
  askAboutQuestion,
  generateExplanationsForQuestion,
  getQuestionExplanations,
} from "@/lib/explanations.functions";
import { RichText, sanitizeExplanationHtml } from "@/components/RichText";
import { markdownToHtml } from "@/lib/markdown";
import { CaseRunner, type ReportReason } from "@/components/session/CaseRunner";
import { useActiveElapsed } from "@/lib/useActiveElapsed";
import {
  createFlashcard,
  createFlashcardsFromSession,
  reportQuestion,
} from "@/lib/flashcards.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Flag,
  StickyNote,
  Timer,
  Sparkles,
  Layers,
  AlertTriangle,
  Search,
  Pause,
  Play,
  LogOut,
} from "lucide-react";
import { ModuleScopeGate } from "@/lib/scopes";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/qcm/$sessionId")({
  validateSearch: (search: Record<string, unknown>): { keepTimer?: boolean } => ({
    keepTimer: search.keepTimer === true || search.keepTimer === "true" ? true : undefined,
  }),
  component: QcmRunnerGate,
});

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function QcmRunnerGate() {
  const { moduleId } = Route.useParams();
  return (
    <ModuleScopeGate moduleId={moduleId} scope="sessions">
      <QcmRunner />
    </ModuleScopeGate>
  );
}

type QType = "qcm" | "qcs" | "qroc" | "cas_clinique";
type Question = {
  id: string;
  type: QType;
  polarity: "correct" | "incorrect";
  stem: string;
  choices: string[] | null;
  correct_indices: number[] | null;
  model_answer: string | null;
  explanation: string | null;
  parent_id: string | null;
  sort_order: number;
};
type Grade = {
  verdict: "correct" | "partial" | "incorrect";
  score: number;
  feedback?: string;
  userAnswer?: string;
};
type Session = {
  id: string;
  question_ids: string[];
  answers: Record<string, any>;
  grades: Record<string, Grade>;
  score: number | null;
  total: number;
  finished_at: string | null;
  mode: string | null;
  time_limit_seconds: number | null;
  started_at: string;
  module_id: string;
  duration_seconds: number | null;
};

function sameSet(a: number[], b: number[]) {
  if (a.length !== b.length) return false;
  const sa = [...a].sort(),
    sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// For a question with polarity, compute the target indices the user should pick.
function targetIndices(q: Question): number[] {
  const correct = q.correct_indices ?? [];
  if (q.polarity === "correct") return correct;
  const all = (q.choices ?? []).map((_, i) => i);
  return all.filter((i) => !correct.includes(i));
}

function gradeChoice(q: Question, ans: any): number {
  if (ans == null) return 0;
  const target = targetIndices(q);
  const picks = Array.isArray(ans) ? ans : [ans];
  return sameSet(picks, target) ? 1 : 0;
}

/** Flashcard "back" text for a whole question, used when creating a card
 *  from the live session (before per-choice AI explanations exist). */
function answerTextFor(q: Question, tr: (s: string) => string): string {
  if ((q.type === "qcm" || q.type === "qcs") && q.choices) {
    const target = targetIndices(q);
    const lines = target.map((i) => `${String.fromCharCode(65 + i)}. ${q.choices![i]}`);
    return lines.join("\n") || tr("(réponse non définie)");
  }
  if (q.type === "qroc") return q.model_answer || q.explanation || tr("(réponse non définie)");
  return q.explanation || tr("(réponse non définie)");
}

function SessionStatsCard({
  score,
  total,
  answered,
  elapsedSeconds,
  tr,
}: {
  score: number;
  total: number;
  answered: number;
  elapsedSeconds: number;
  tr: (s: string) => string;
}) {
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;
  const sec = Math.max(0, elapsedSeconds);
  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-base">{tr("Statistiques de la session")}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="text-center">
          <div className="text-2xl font-bold">
            {Math.round(score * 10) / 10}/{total}
          </div>
          <div className="text-xs text-muted-foreground">{tr("Score")}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">{pct}%</div>
          <div className="text-xs text-muted-foreground">{tr("Réussite")}</div>
        </div>
        <div className="text-center">
          <div className="text-2xl font-bold">
            {answered}/{total}
          </div>
          <div className="text-xs text-muted-foreground">{tr("Répondues")}</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-2xl font-bold">
            {Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}
          </div>
          <div className="text-xs text-muted-foreground">{tr("Temps")}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function QcmRunner() {
  const { tr } = useI18n();
  const { moduleId, sessionId } = Route.useParams();
  const { keepTimer } = Route.useSearch();
  const grade = useServerFn(gradeQrocAnswer);
  const flag = useServerFn(toggleFlag);
  const saveNote = useServerFn(upsertNote);
  const review = useServerFn(submitReview);
  const autoCards = useServerFn(createFlashcardsFromSession);
  const ask = useServerFn(askAboutQuestion);
  const report = useServerFn(reportQuestion);
  const addCard = useServerFn(createFlashcard);
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const [reviewing, setReviewing] = useState(false);
  const [gradingId, setGradingId] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [resumeQid, setResumeQid] = useState<string | null>(null);
  const [askQueries, setAskQueries] = useState<Record<string, string>>({});
  const [askAnswers, setAskAnswers] = useState<Record<string, string>>({});
  const [askingId, setAskingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>("missing_rotation");
  const [reportDetails, setReportDetails] = useState("");
  const [paused, setPaused] = useState(false);
  const [quitting, setQuitting] = useState(false);
  const [finalDuration, setFinalDuration] = useState<number | null>(null);
  const finishedRef = useRef(false);

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase
        .from("qcm_sessions")
        .select(
          "id,question_ids,answers,grades,score,total,finished_at,mode,time_limit_seconds,started_at,module_id,duration_seconds",
        )
        .eq("id", sessionId)
        .maybeSingle();
      if (!s) return;
      const sess = s as unknown as Session;
      setSession(sess);
      setAnswers(sess.answers ?? {});
      setGrades(sess.grades ?? {});
      if (sess.finished_at) setReviewing(true);
      const ids = sess.question_ids;
      if (ids.length > 0) {
        // Fetch main questions + their sub-questions (for cas clinique)
        const { data: qs } = await supabase.from("questions").select("*").in("id", ids);
        const mains = ((qs as Question[]) ?? []).sort(
          (a, b) => ids.indexOf(a.id) - ids.indexOf(b.id),
        );
        const caseIds = mains.filter((m) => m.type === "cas_clinique").map((m) => m.id);
        let subs: Question[] = [];
        if (caseIds.length > 0) {
          const { data: sq } = await supabase
            .from("questions")
            .select("*")
            .in("parent_id", caseIds);
          subs = (sq as Question[]) ?? [];
        }
        // Group: main followed by its sub-questions (sorted)
        const ordered: Question[] = [];
        for (const m of mains) {
          ordered.push(m);
          if (m.type === "cas_clinique") {
            ordered.push(
              ...subs
                .filter((sb) => sb.parent_id === m.id)
                .sort((a, b) => a.sort_order - b.sort_order),
            );
          }
        }
        setQuestions(ordered);
        // Resume: jump to the first unanswered question of an unfinished session
        if (!sess.finished_at) {
          const ans = sess.answers ?? {};
          const gr = sess.grades ?? {};
          const isAnswered = (q: Question) => {
            if (q.type === "cas_clinique") return true; // vignette only, nothing to answer
            if (q.type === "qroc") return gr[q.id] != null;
            const a = ans[q.id];
            return Array.isArray(a) ? a.length > 0 : a != null;
          };
          const firstOpen = ordered.findIndex((q) => !isAnswered(q));
          if (firstOpen > 0) {
            setResumeQid(ordered[firstOpen]!.id);
            toast.info(
              tr("Session reprise à la question {n}/{total}")
                .replace("{n}", String(firstOpen + 1))
                .replace("{total}", String(ordered.length)),
            );
          }
        }
        const orderedIds = ordered.map((q) => q.id);
        const { data: u } = await supabase.auth.getUser();
        if (u.user && orderedIds.length > 0) {
          const [{ data: fs }, { data: ns }] = await Promise.all([
            supabase
              .from("question_flags")
              .select("question_id")
              .eq("user_id", u.user.id)
              .in("question_id", orderedIds),
            supabase
              .from("question_notes")
              .select("question_id,body")
              .eq("user_id", u.user.id)
              .in("question_id", orderedIds),
          ]);
          setFlagged(new Set((fs ?? []).map((r: any) => r.question_id)));
          const nm: Record<string, string> = {};
          for (const r of ns ?? []) nm[(r as any).question_id] = (r as any).body;
          setNotes(nm);
        }
      }
    })();
  }, [sessionId]);

  // Timer tick — keeps the header clock (elapsed or exam countdown) live.
  useEffect(() => {
    if (!session || reviewing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session, reviewing]);

  const isExam = session?.mode === "exam";
  const timeLeft = useMemo(() => {
    if (!session?.time_limit_seconds || !session.started_at) return null;
    const elapsed = Math.floor((now - new Date(session.started_at).getTime()) / 1000);
    return Math.max(0, session.time_limit_seconds - elapsed);
  }, [session, now]);
  // Practice mode only: pauses while the tab isn't visible/focused, is
  // manually paused, or the quit-stats screen is open — so the displayed
  // timer (and the duration_seconds saved on finish/quit) reflect actual
  // engaged time rather than wall-clock time. Exam mode keeps its
  // wall-clock countdown above — a timed exam shouldn't pause on tab-switch.
  // `?keepTimer=1` (set by the "resume, keep timer" link in history) seeds
  // the counter from the session's previously-saved duration instead of 0.
  const { seconds: activeElapsed, getSeconds: getActiveElapsedSeconds } = useActiveElapsed(
    !!session && !reviewing && !isExam && !paused && !quitting,
    keepTimer ? (session?.duration_seconds ?? 0) : 0,
  );
  const elapsed = session?.started_at ? activeElapsed : null;

  // Best-effort: persist how far the timer got if the user navigates away
  // (back button, closing the tab, an internal Link) without hitting
  // "Quitter" — so a later resume always has an up-to-date duration to
  // build on, and the history list's "· X min" reflects real progress.
  const sessionForUnmountRef = useRef(session);
  useEffect(() => {
    sessionForUnmountRef.current = session;
  }, [session]);
  const reviewingRef = useRef(reviewing);
  useEffect(() => {
    reviewingRef.current = reviewing;
  }, [reviewing]);
  useEffect(() => {
    return () => {
      const s = sessionForUnmountRef.current;
      if (!s || reviewingRef.current || s.mode === "exam") return;
      const dur = getActiveElapsedSeconds();
      if (dur > 0) {
        supabase
          .from("qcm_sessions")
          .update({ duration_seconds: dur })
          .eq("id", s.id)
          .then(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effective total = choice-graded + qroc + sub-questions (case vignettes themselves are informational)
  const gradableQuestions = useMemo(
    () => questions.filter((q) => q.type !== "cas_clinique"),
    [questions],
  );
  const answeredCount = useMemo(
    () =>
      gradableQuestions.filter((qq) => {
        if (qq.type === "qroc") return grades[qq.id] != null;
        const a = answers[qq.id];
        return Array.isArray(a) ? a.length > 0 : a != null;
      }).length,
    [gradableQuestions, answers, grades],
  );

  const quit = () => {
    setQuitting(true);
    if (session && session.mode !== "exam") {
      const dur = getActiveElapsedSeconds();
      supabase
        .from("qcm_sessions")
        .update({ duration_seconds: dur })
        .eq("id", session.id)
        .then(() => {});
    }
  };

  // Steps: a clinical case (vignette + its sub-questions) is a single step.
  type Step =
    { kind: "single"; q: Question } | { kind: "case"; parent: Question; subs: Question[] };
  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];
    for (const qq of questions) {
      if (qq.type === "cas_clinique") {
        out.push({
          kind: "case",
          parent: qq,
          subs: questions.filter((s) => s.parent_id === qq.id),
        });
      } else if (!qq.parent_id) {
        out.push({ kind: "single", q: qq });
      }
    }
    return out;
  }, [questions]);

  useEffect(() => {
    if (!resumeQid || steps.length === 0) return;
    const i = steps.findIndex((s) =>
      s.kind === "single"
        ? s.q.id === resumeQid
        : s.parent.id === resumeQid || s.subs.some((x) => x.id === resumeQid),
    );
    if (i > 0) setIdx(i);
    setResumeQid(null);
  }, [resumeQid, steps]);

  const currentScore = useMemo(() => {
    let s = 0;
    for (const q of gradableQuestions) {
      if (q.type === "qroc") {
        const g = grades[q.id];
        if (g) s += g.score;
      } else {
        s += gradeChoice(q, answers[q.id]);
      }
    }
    return s;
  }, [gradableQuestions, answers, grades]);

  const persistAnswers = async (next: Record<string, any>) => {
    await supabase.from("qcm_sessions").update({ answers: next }).eq("id", sessionId);
  };

  const setChoice = (q: Question, choiceIdx: number) => {
    if (reviewing) return;
    if (!isExam && revealed.has(q.id)) return;
    let next: any;
    if (q.type === "qcm") {
      const cur: number[] = Array.isArray(answers[q.id]) ? answers[q.id] : [];
      next = cur.includes(choiceIdx)
        ? cur.filter((v) => v !== choiceIdx)
        : [...cur, choiceIdx].sort();
    } else {
      next = choiceIdx;
    }
    const updated = { ...answers, [q.id]: next };
    setAnswers(updated);
    persistAnswers(updated);
  };

  const setQrocText = (q: Question, text: string) => {
    if (reviewing) return;
    const updated = { ...answers, [q.id]: text };
    setAnswers(updated);
  };

  const validate = (q: Question) => {
    setRevealed((prev) => new Set(prev).add(q.id));
  };

  const submitQroc = async (q: Question) => {
    const text = String(answers[q.id] ?? "").trim();
    if (!text) {
      toast.error(tr("Écrivez votre réponse"));
      return;
    }
    setGradingId(q.id);
    try {
      await supabase
        .from("qcm_sessions")
        .update({ answers: { ...answers, [q.id]: text } })
        .eq("id", sessionId);
      const result = await grade({ data: { sessionId, questionId: q.id, userAnswer: text } });
      setGrades((prev) => ({ ...prev, [q.id]: { ...result, userAnswer: text } }));
      toast.success(tr("Corrigé"));
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur de correction"));
    } finally {
      setGradingId(null);
    }
  };

  const submitAsk = async (questionId: string) => {
    const query = (askQueries[questionId] ?? "").trim();
    if (!query) return;
    setAskingId(questionId);
    try {
      const res: any = await withTimeout(
        ask({ data: { questionId, query } }),
        30_000,
        tr("Délai dépassé, réessayez"),
      );
      setAskAnswers((prev) => ({ ...prev, [questionId]: res.answer }));
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur IA"));
    } finally {
      setAskingId(null);
    }
  };

  const finish = async () => {
    if (!session) return;
    if (finishedRef.current) return;
    finishedRef.current = true;
    const total = gradableQuestions.length;
    // Exam mode: wall-clock duration (tied to the enforced time limit).
    // Practice mode: active-engaged time only (paused while tab hidden/unfocused).
    const duration = isExam
      ? Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)
      : getActiveElapsedSeconds();
    setFinalDuration(duration);
    const { error } = await supabase
      .from("qcm_sessions")
      .update({
        answers,
        score: currentScore,
        total,
        finished_at: new Date().toISOString(),
        duration_seconds: duration,
      })
      .eq("id", sessionId);
    if (error) {
      toast.error(error.message);
      return;
    }
    // Push SM-2 review for each gradable question
    for (const q of gradableQuestions) {
      let correct = false;
      let sc = 0;
      if (q.type === "qroc") {
        const g = grades[q.id];
        sc = g?.score ?? 0;
        correct = g?.verdict === "correct";
      } else {
        sc = gradeChoice(q, answers[q.id]);
        correct = sc >= 1;
      }
      review({ data: { questionId: q.id, correct, score: sc } }).catch(() => {});
    }
    setReviewing(true);
    setIdx(0);
    // Best-effort: auto-create flashcards from mistakes
    autoCards({ data: { sessionId } })
      .then((r: any) => {
        if (r?.created > 0)
          toast.success(
            `${r.created} ${tr("flashcard")}${r.created > 1 ? "s" : ""} ${tr("ajoutée")}${r.created > 1 ? "s" : ""}`,
          );
      })
      .catch(() => {});
  };

  // Auto-finish when timer hits 0 in exam mode
  useEffect(() => {
    if (isExam && timeLeft === 0 && !reviewing) {
      toast.info(tr("Temps écoulé — session terminée"));
      finish();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, isExam, reviewing]);

  // Keyboard navigation for the live session: ← → to move between
  // questions, letters matching the on-screen A/B/C… labels to answer,
  // Enter to validate. Never fires while the user is typing (QROC answer,
  // note, report dialog, "ask AI" inputs) or has a modifier held.
  useEffect(() => {
    if (reviewing) return;
    const step = steps[idx];
    if (!step) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const isTyping =
        !!el &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
          el.isContentEditable ||
          !!el.closest('[role="dialog"], [role="listbox"]'));
      if (isTyping) return;

      if (e.key === "ArrowLeft") {
        if (idx > 0) {
          e.preventDefault();
          setIdx(idx - 1);
        }
        return;
      }
      if (e.key === "ArrowRight") {
        if (idx < steps.length - 1) {
          e.preventDefault();
          setIdx(idx + 1);
        }
        return;
      }
      if (step.kind !== "single") return;
      const q = step.q;
      if (
        e.key === "Enter" &&
        !isExam &&
        !revealed.has(q.id) &&
        (q.type === "qcm" || q.type === "qcs") &&
        answers[q.id] != null &&
        (!Array.isArray(answers[q.id]) || answers[q.id].length > 0)
      ) {
        e.preventDefault();
        validate(q);
        return;
      }
      if (
        (q.type === "qcm" || q.type === "qcs") &&
        q.choices &&
        !(!isExam && revealed.has(q.id)) &&
        /^[a-zA-Z]$/.test(e.key)
      ) {
        const j = e.key.toUpperCase().charCodeAt(0) - 65;
        if (j >= 0 && j < q.choices.length) {
          e.preventDefault();
          setChoice(q, j);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewing, idx, steps, isExam, revealed, answers]);

  const doFlag = async (q: Question) => {
    try {
      const res = await flag({ data: { questionId: q.id } });
      setFlagged((prev) => {
        const next = new Set(prev);
        if (res.flagged) next.add(q.id);
        else next.delete(q.id);
        return next;
      });
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  const saveNoteFor = async (q: Question, body: string) => {
    setNotes((prev) => ({ ...prev, [q.id]: body }));
    try {
      await saveNote({ data: { questionId: q.id, body } });
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  const submitReport = async (q: Question, reason: ReportReason, details?: string) => {
    try {
      await report({ data: { questionId: q.id, reason, details } });
      toast.success(tr("Signalement envoyé"));
      setReportDetails("");
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  const saveCardLive = async (q: Question) => {
    try {
      await addCard({
        data: {
          front: q.stem,
          back: answerTextFor(q, tr),
          question_id: q.id,
          choice_index: null,
          module_id: moduleId,
        },
      });
      toast.success(tr("Ajouté aux flashcards"));
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  if (!session) return <div className="p-10 text-center text-muted-foreground">…</div>;

  const step = steps[idx];
  const q = step?.kind === "single" ? step.q : undefined;
  const revealAll = (ids: string[]) =>
    setRevealed((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/modules/$moduleId/entrainement" params={{ moduleId }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Sessions")}
            </Link>
          </Button>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {isExam && timeLeft != null && !reviewing && (
              <div
                className={`flex items-center gap-1.5 font-mono ${timeLeft < 60 ? "text-red-600" : ""}`}
              >
                <Timer className="h-4 w-4" />
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, "0")}
              </div>
            )}
            {!isExam && elapsed != null && !reviewing && (
              <div className="flex items-center gap-1.5 font-mono">
                <Timer className="h-4 w-4" />
                {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
              </div>
            )}
            {reviewing
              ? `${Math.round(currentScore * 10) / 10} / ${gradableQuestions.length}`
              : `${idx + 1} / ${steps.length}`}
            {!reviewing && !quitting && (
              <div className="flex items-center gap-1">
                {!isExam && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPaused((p) => !p)}
                    title={paused ? tr("Reprendre") : tr("Mettre en pause")}
                  >
                    {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={quit} title={tr("Quitter")}>
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8 space-y-4">
        {!reviewing && (
          <div className="h-1.5 w-full rounded bg-muted overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${((idx + 1) / Math.max(1, steps.length)) * 100}%` }}
            />
          </div>
        )}

        {reviewing ? (
          <>
            <SessionStatsCard
              score={currentScore}
              total={gradableQuestions.length}
              answered={answeredCount}
              elapsedSeconds={finalDuration ?? 0}
              tr={tr}
            />
            <ReviewList
              questions={questions}
              answers={answers}
              grades={grades}
              score={currentScore}
              total={gradableQuestions.length}
              moduleId={moduleId}
            />
            <div className="flex justify-center gap-2 pt-4">
              <Button asChild variant="outline">
                <Link to="/modules/$moduleId/entrainement" params={{ moduleId }}>
                  {tr("Nouvelle session")}
                </Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/questions/history">{tr("Historique")}</Link>
              </Button>
            </div>
          </>
        ) : quitting ? (
          <>
            <SessionStatsCard
              score={currentScore}
              total={gradableQuestions.length}
              answered={answeredCount}
              elapsedSeconds={activeElapsed}
              tr={tr}
            />
            <div className="flex justify-center gap-2 pt-2">
              <Button variant="outline" onClick={() => setQuitting(false)}>
                {tr("Continuer la session")}
              </Button>
              <Button variant="destructive" asChild>
                <Link to="/questions/history">{tr("Quitter")}</Link>
              </Button>
            </div>
          </>
        ) : paused ? (
          <Card className="mx-auto max-w-sm">
            <CardContent className="space-y-4 py-12 text-center">
              <Pause className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="text-muted-foreground">{tr("Session en pause")}</p>
              <Button onClick={() => setPaused(false)}>
                <Play className="mr-1.5 h-4 w-4" />
                {tr("Reprendre")}
              </Button>
            </CardContent>
          </Card>
        ) : step?.kind === "case" ? (
          <>
            <CaseRunner
              parent={step.parent}
              subs={step.subs}
              answers={answers}
              grades={grades as any}
              revealed={revealed}
              isExam={!!isExam}
              gradingId={gradingId}
              flagged={flagged}
              onChoice={(qq, j) => setChoice(qq as Question, j)}
              onQrocText={(qq, t) => setQrocText(qq as Question, t)}
              onSubmitQroc={(qq) => submitQroc(qq as Question)}
              onRevealAll={revealAll}
              onFlag={(qq) => doFlag(qq as Question)}
              onReport={(qq, reason, details) => submitReport(qq as Question, reason, details)}
              onSaveCard={(qq, front, back) =>
                addCard({
                  data: {
                    front,
                    back,
                    question_id: qq.id,
                    choice_index: null,
                    module_id: moduleId,
                  },
                })
                  .then(() => toast.success(tr("Ajouté aux flashcards")))
                  .catch((e: any) => toast.error(e.message ?? tr("Erreur")))
              }
            />
            <div className="flex justify-between pt-1">
              <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                {tr("Précédent")}
              </Button>
              {idx < steps.length - 1 ? (
                <Button variant="outline" onClick={() => setIdx(idx + 1)}>
                  {tr("Suivant")}
                </Button>
              ) : (
                <Button variant="outline" onClick={finish}>
                  {tr("Terminer")}
                </Button>
              )}
            </div>
            <StepNavigator
              steps={steps}
              idx={idx}
              answers={answers}
              flagged={flagged}
              onGo={setIdx}
            />
            <p className="text-center text-xs text-muted-foreground">
              {tr("Raccourcis : ← → pour naviguer, lettres pour répondre, Entrée pour valider")}
            </p>
          </>
        ) : q ? (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{q.type.toUpperCase()}</Badge>
                  {(q.type === "qcm" || q.type === "qcs") && (
                    <Badge variant={q.polarity === "incorrect" ? "destructive" : "secondary"}>
                      {q.polarity === "incorrect"
                        ? tr("Cochez les MAUVAISES réponses")
                        : tr("Cochez les BONNES réponses")}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => saveCardLive(q)}
                      title={tr("Ajouter aux flashcards")}
                    >
                      <Layers className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => doFlag(q)} title={tr("Flag")}>
                      <Flag
                        className={`h-4 w-4 ${flagged.has(q.id) ? "fill-current text-primary" : ""}`}
                      />
                    </Button>
                    <Sheet>
                      <SheetTrigger asChild>
                        <Button size="sm" variant="ghost" title={tr("Note")}>
                          <StickyNote className={`h-4 w-4 ${notes[q.id] ? "text-primary" : ""}`} />
                        </Button>
                      </SheetTrigger>
                      <SheetContent>
                        <SheetHeader>
                          <SheetTitle>{tr("Note personnelle")}</SheetTitle>
                        </SheetHeader>
                        <Textarea
                          rows={12}
                          className="mt-4"
                          defaultValue={notes[q.id] ?? ""}
                          onBlur={(e) => saveNoteFor(q, e.target.value)}
                          placeholder={tr("Vos remarques sur cette question…")}
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          {tr("Sauvegarde automatique à la sortie du champ.")}
                        </p>
                      </SheetContent>
                    </Sheet>
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="ghost" title={tr("Signaler un problème")}>
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{tr("Signaler la question")}</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <Select
                            value={reportReason}
                            onValueChange={(v) => setReportReason(v as ReportReason)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="missing_rotation">
                                {tr("Rotation / année manquante")}
                              </SelectItem>
                              <SelectItem value="wrong_answer">{tr("Mauvaise réponse")}</SelectItem>
                              <SelectItem value="wrong_vocabulary">
                                {tr("Vocabulaire incorrect")}
                              </SelectItem>
                              <SelectItem value="other">{tr("Autre")}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Textarea
                            rows={4}
                            placeholder={tr("Détails (optionnel)")}
                            value={reportDetails}
                            onChange={(e) => setReportDetails(e.target.value)}
                          />
                        </div>
                        <DialogFooter>
                          <Button
                            onClick={() =>
                              submitReport(q, reportReason, reportDetails || undefined)
                            }
                          >
                            {tr("Envoyer")}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
                <CardTitle className="text-base whitespace-pre-wrap">{q.stem}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {q.type === "cas_clinique" && (
                  <p className="text-sm text-muted-foreground italic">
                    {tr("Lisez le cas puis passez à la suite pour répondre aux questions.")}
                  </p>
                )}
                {(q.type === "qcm" || q.type === "qcs") && q.choices && (
                  <div className="space-y-2">
                    {q.choices.map((ch, j) => {
                      const cur = answers[q.id];
                      const chosen = Array.isArray(cur) ? cur.includes(j) : cur === j;
                      const showFeedback = !isExam && revealed.has(q.id);
                      const target = targetIndices(q);
                      const isTarget = target.includes(j);
                      const wrong = showFeedback && chosen && !isTarget;
                      const missed = showFeedback && isTarget && !chosen;
                      const cls = showFeedback
                        ? isTarget
                          ? "border-green-500 bg-green-500/10"
                          : wrong
                            ? "border-red-500 bg-red-500/10"
                            : "border-border"
                        : chosen
                          ? "border-primary bg-accent"
                          : "border-border hover:bg-accent";
                      return (
                        <button
                          key={j}
                          onClick={() => setChoice(q, j)}
                          disabled={showFeedback}
                          className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition ${cls}`}
                        >
                          {showFeedback && isTarget && (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          )}
                          {showFeedback && wrong && <XCircle className="h-4 w-4 text-red-600" />}
                          <span className="font-mono text-xs">{String.fromCharCode(65 + j)}.</span>
                          <span className="flex-1">{ch}</span>
                          {missed && (
                            <span className="text-[10px] text-green-700">{tr("à cocher")}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {q.type === "qroc" && (
                  <div className="space-y-2">
                    <Textarea
                      rows={5}
                      value={answers[q.id] ?? ""}
                      onChange={(e) => setQrocText(q, e.target.value)}
                      placeholder={tr("Votre réponse…")}
                      disabled={!isExam && !!grades[q.id]}
                    />
                    {!isExam && grades[q.id] ? (
                      <QrocFeedback grade={grades[q.id]} modelAnswer={q.model_answer} />
                    ) : !isExam ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => submitQroc(q)}
                        disabled={gradingId === q.id}
                      >
                        {gradingId === q.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                        {tr("Corriger avec l'IA")}
                      </Button>
                    ) : null}
                  </div>
                )}
                {!isExam &&
                  revealed.has(q.id) &&
                  (q.type === "qcm" || q.type === "qcs" || q.type === "qroc") &&
                  (q.explanation || q.model_answer) && (
                    <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                      <div className="text-xs font-semibold text-primary flex items-center gap-1">
                        <Sparkles className="h-3 w-3" />
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
                          className="text-sm prose prose-sm dark:prose-invert max-w-none"
                        />
                      )}
                    </div>
                  )}
                {!isExam &&
                  revealed.has(q.id) &&
                  (q.type === "qcm" || q.type === "qcs" || q.type === "qroc") && (
                    <div className="pt-2 border-t">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
                        <Search className="h-3.5 w-3.5" />
                        {tr("Poser une question à l'IA sur ce sujet")}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={askQueries[q.id] ?? ""}
                          onChange={(e) =>
                            setAskQueries((prev) => ({ ...prev, [q.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && askingId !== q.id) submitAsk(q.id);
                          }}
                          placeholder={tr("Ex : pourquoi cette réponse est fausse ?")}
                          className="text-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => submitAsk(q.id)}
                          disabled={askingId === q.id || !(askQueries[q.id] ?? "").trim()}
                        >
                          {askingId === q.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Search className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                      {askAnswers[q.id] && (
                        <div
                          className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm prose prose-sm dark:prose-invert max-w-none"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeExplanationHtml(markdownToHtml(askAnswers[q.id])),
                          }}
                        />
                      )}
                    </div>
                  )}
                <div className="flex justify-between pt-3">
                  <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>
                    {tr("Précédent")}
                  </Button>
                  <div className="flex gap-2">
                    {!isExam && !revealed.has(q.id) && (q.type === "qcm" || q.type === "qcs") && (
                      <Button
                        variant="secondary"
                        disabled={
                          answers[q.id] == null ||
                          (Array.isArray(answers[q.id]) && answers[q.id].length === 0)
                        }
                        onClick={() => validate(q)}
                      >
                        {tr("Valider")}
                      </Button>
                    )}
                    {idx < steps.length - 1 ? (
                      <Button onClick={() => setIdx(idx + 1)}>{tr("Suivant")}</Button>
                    ) : (
                      <Button onClick={finish}>{tr("Terminer")}</Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            <StepNavigator
              steps={steps}
              idx={idx}
              answers={answers}
              flagged={flagged}
              onGo={setIdx}
            />
            <p className="text-center text-xs text-muted-foreground">
              {tr("Raccourcis : ← → pour naviguer, lettres pour répondre, Entrée pour valider")}
            </p>
          </>
        ) : null}
      </main>
    </div>
  );
}

function QrocFeedback({ grade, modelAnswer }: { grade: Grade; modelAnswer: string | null }) {
  return <QrocFeedbackInner grade={grade} modelAnswer={modelAnswer} />;
}

type AnyStep =
  { kind: "single"; q: Question } | { kind: "case"; parent: Question; subs: Question[] };

function StepNavigator({
  steps,
  idx,
  answers,
  flagged,
  onGo,
}: {
  steps: AnyStep[];
  idx: number;
  answers: Record<string, any>;
  flagged: Set<string>;
  onGo: (i: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {steps.map((s, i) => {
        const ids = s.kind === "single" ? [s.q.id] : s.subs.map((x) => x.id);
        const answered =
          ids.length > 0 && ids.every((id) => answers[id] != null && answers[id] !== "");
        const isCurrent = i === idx;
        const isFlagged = ids.some((id) => flagged.has(id));
        return (
          <button
            key={s.kind === "single" ? s.q.id : s.parent.id}
            onClick={() => onGo(i)}
            title={s.kind === "case" ? "Cas clinique" : undefined}
            className={`h-7 min-w-7 rounded px-1.5 text-xs font-mono border ${isCurrent ? "border-primary bg-primary text-primary-foreground" : answered ? "border-primary/40 bg-accent" : "border-border"} ${isFlagged ? "ring-1 ring-amber-500" : ""}`}
          >
            {s.kind === "case" ? `CC${i + 1}` : i + 1}
          </button>
        );
      })}
    </div>
  );
}

function QrocFeedbackInner({ grade, modelAnswer }: { grade: Grade; modelAnswer: string | null }) {
  const { tr } = useI18n();
  const color =
    grade.verdict === "correct"
      ? "text-green-600"
      : grade.verdict === "partial"
        ? "text-amber-600"
        : "text-red-600";
  return (
    <div className="rounded-md border p-3 text-sm space-y-2 bg-muted/30">
      <div className={`font-semibold ${color}`}>
        {tr("Score : ")}
        {Math.round(grade.score * 100)}% — {grade.verdict}
      </div>
      {grade.feedback && <p className="text-muted-foreground">{grade.feedback}</p>}
      {modelAnswer && (
        <div>
          <div className="text-xs font-medium mb-1">{tr("Réponse attendue :")}</div>
          <div className="text-xs whitespace-pre-wrap">{modelAnswer}</div>
        </div>
      )}
    </div>
  );
}

function ReviewList({
  questions,
  answers,
  grades,
  score,
  total,
  moduleId,
}: {
  questions: Question[];
  answers: Record<string, any>;
  grades: Record<string, Grade>;
  score: number;
  total: number;
  moduleId: string;
}) {
  const { tr } = useI18n();
  return (
    <>
      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-3xl font-semibold">
            {Math.round(score * 10) / 10} / {total}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            {total > 0 ? Math.round((score / total) * 100) : 0}%
          </p>
        </CardContent>
      </Card>
      {questions.map((q, i) => {
        if (q.parent_id) return null; // rendered inside its case group
        if (q.type === "cas_clinique") {
          const subs = questions.filter((s) => s.parent_id === q.id);
          return (
            <div
              key={q.id}
              className="space-y-2 rounded-2xl border border-primary/40 bg-muted/30 p-3"
            >
              <div className="text-xs font-bold uppercase tracking-widest text-primary">
                {tr("Cas clinique")}
              </div>
              <RichText
                html={q.stem}
                className="prose prose-sm max-w-none whitespace-pre-wrap text-sm dark:prose-invert"
              />
              <div className="space-y-2">
                {subs.map((s, j) => (
                  <ReviewCard
                    key={s.id}
                    q={s}
                    idx={j}
                    userAns={answers[s.id]}
                    grade={grades[s.id]}
                    moduleId={moduleId}
                  />
                ))}
              </div>
            </div>
          );
        }
        return (
          <ReviewCard
            key={q.id}
            q={q}
            idx={i}
            userAns={answers[q.id]}
            grade={grades[q.id]}
            moduleId={moduleId}
          />
        );
      })}
    </>
  );
}

function ReviewCard({
  q,
  idx,
  userAns,
  grade,
  moduleId,
}: {
  q: Question;
  idx: number;
  userAns: any;
  grade?: Grade;
  moduleId: string;
}) {
  const { tr } = useI18n();
  const target = targetIndices(q);
  const genExpl = useServerFn(generateExplanationsForQuestion);
  const getExpl = useServerFn(getQuestionExplanations);
  const addCard = useServerFn(createFlashcard);
  const report = useServerFn(reportQuestion);
  const ask = useServerFn(askAboutQuestion);
  const [expl, setExpl] = useState<Record<string, string>>({}); // key: choice_index or "overall"
  const [loadingExpl, setLoadingExpl] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("missing_rotation");
  const [reportDetails, setReportDetails] = useState("");
  const [askQuery, setAskQuery] = useState("");
  const [askAnswer, setAskAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await getExpl({ data: { questionId: q.id } });
      const map: Record<string, string> = {};
      for (const r of (res as any).rows)
        map[r.choice_index == null ? "overall" : String(r.choice_index)] = r.body;
      setExpl(map);
    })();
  }, [q.id, getExpl]);

  const generate = async () => {
    setLoadingExpl(true);
    try {
      await genExpl({ data: { questionId: q.id } });
      const res = await getExpl({ data: { questionId: q.id } });
      const map: Record<string, string> = {};
      for (const r of (res as any).rows)
        map[r.choice_index == null ? "overall" : String(r.choice_index)] = r.body;
      setExpl(map);
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur IA"));
    } finally {
      setLoadingExpl(false);
    }
  };

  const saveCard = async (front: string, back: string, choiceIdx?: number) => {
    try {
      await addCard({
        data: {
          front,
          back,
          question_id: q.id,
          choice_index: choiceIdx ?? null,
          module_id: moduleId,
        },
      });
      toast.success(tr("Ajouté aux flashcards"));
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  const submitReport = async () => {
    try {
      await report({
        data: { questionId: q.id, reason: reportReason, details: reportDetails || undefined },
      });
      toast.success(tr("Signalement envoyé"));
      setReportDetails("");
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur"));
    }
  };

  const submitAsk = async () => {
    if (!askQuery.trim()) return;
    setAsking(true);
    try {
      const res: any = await withTimeout(
        ask({ data: { questionId: q.id, query: askQuery.trim() } }),
        30_000,
        tr("Délai dépassé, réessayez"),
      );
      setAskAnswer(res.answer);
    } catch (e: any) {
      toast.error(e.message ?? tr("Erreur IA"));
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline">{q.type.toUpperCase()}</Badge>
          {(q.type === "qcm" || q.type === "qcs") && q.polarity === "incorrect" && (
            <Badge variant="destructive">{tr("mauvaises réponses")}</Badge>
          )}
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" onClick={generate} disabled={loadingExpl}>
              {loadingExpl ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="ml-1 hidden sm:inline">{tr("Expliquer")}</span>
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  <AlertTriangle className="h-4 w-4" />
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{tr("Signaler la question")}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <Select
                    value={reportReason}
                    onValueChange={(v) => setReportReason(v as ReportReason)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="missing_rotation">
                        {tr("Rotation / année manquante")}
                      </SelectItem>
                      <SelectItem value="wrong_answer">{tr("Mauvaise réponse")}</SelectItem>
                      <SelectItem value="wrong_vocabulary">
                        {tr("Vocabulaire incorrect")}
                      </SelectItem>
                      <SelectItem value="other">{tr("Autre")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Textarea
                    rows={4}
                    placeholder={tr("Détails (optionnel)")}
                    value={reportDetails}
                    onChange={(e) => setReportDetails(e.target.value)}
                  />
                </div>
                <DialogFooter>
                  <Button onClick={submitReport}>{tr("Envoyer")}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>
        <CardTitle className="text-base whitespace-pre-wrap">
          {idx + 1}. {q.stem}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {(q.type === "qcm" || q.type === "qcs") &&
          q.choices &&
          q.choices.map((ch, j) => {
            const isTarget = target.includes(j);
            const isChosen = Array.isArray(userAns) ? userAns.includes(j) : userAns === j;
            const wrong = isChosen && !isTarget;
            const missed = isTarget && !isChosen;
            const explBody = expl[String(j)];
            return (
              <div
                key={j}
                className={`rounded-md border px-3 py-2 text-sm ${isTarget ? "bg-green-500/10 border-green-500" : ""} ${wrong ? "bg-red-500/10 border-red-500" : ""}`}
              >
                <div className="flex items-center gap-2">
                  {isTarget && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {wrong && <XCircle className="h-4 w-4 text-red-600" />}
                  <span className="font-mono text-xs">{String.fromCharCode(65 + j)}.</span>
                  <span className="flex-1">{ch}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={tr("Ajouter aux flashcards")}
                    onClick={() =>
                      saveCard(
                        `${q.stem}\n\nOption ${String.fromCharCode(65 + j)}: ${ch}`,
                        explBody ||
                          (isTarget ? tr("✓ Bonne réponse") : tr("✗ Mauvaise réponse")) +
                            (q.explanation ? "\n" + q.explanation : ""),
                        j,
                      )
                    }
                  >
                    <Layers className="h-4 w-4" />
                  </Button>
                </div>
                {explBody && (wrong || missed || isTarget) && (
                  <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap border-l-2 border-primary/30 pl-2">
                    {explBody}
                  </div>
                )}
              </div>
            );
          })}
        {q.type === "qroc" && (
          <>
            <div className="rounded-md border p-3 text-sm bg-muted/30">
              <div className="text-xs font-medium mb-1">{tr("Votre réponse :")}</div>
              <div className="whitespace-pre-wrap">{String(userAns ?? "—")}</div>
            </div>
            {grade && <QrocFeedback grade={grade} modelAnswer={q.model_answer} />}
          </>
        )}
        {expl["overall"] && (
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm whitespace-pre-wrap">
            <div className="text-xs font-semibold text-primary mb-1 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              {tr("Explication IA")}
            </div>
            {expl["overall"]}
          </div>
        )}
        {q.explanation && (
          <RichText
            autoColor
            html={q.explanation}
            className="text-xs text-muted-foreground pt-2 prose prose-sm dark:prose-invert max-w-none"
          />
        )}
        <div className="pt-2 border-t">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mb-1.5">
            <Search className="h-3.5 w-3.5" />
            {tr("Poser une question à l'IA sur ce sujet")}
          </div>
          <div className="flex gap-2">
            <Input
              value={askQuery}
              onChange={(e) => setAskQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !asking) submitAsk();
              }}
              placeholder={tr("Ex : pourquoi cette réponse est fausse ?")}
              className="text-sm"
            />
            <Button size="sm" onClick={submitAsk} disabled={asking || !askQuery.trim()}>
              {asking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Search className="h-4 w-4" />
              )}
            </Button>
          </div>
          {askAnswer && (
            <div
              className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm prose prose-sm dark:prose-invert max-w-none"
              dangerouslySetInnerHTML={{
                __html: sanitizeExplanationHtml(markdownToHtml(askAnswer)),
              }}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
