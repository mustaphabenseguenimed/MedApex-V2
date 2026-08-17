import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { issueModuleFileToken } from "@/lib/moduleFile.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, XCircle, Maximize2, Minus, Plus, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ModuleScopeGate } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/$contentId")({
  component: ContentGate,
});

function ContentGate() {
  const { moduleId } = Route.useParams();
  return <ModuleScopeGate moduleId={moduleId} scope="lessons"><ContentView /></ModuleScopeGate>;
}

type QuizItem = { q: string; choices: string[]; answer: number; explanation?: string };
type Content = {
  id: string; kind: "html" | "pdf" | "richtext" | "quiz" | "link";
  title: string; body: string | null; file_path: string | null; quiz: QuizItem[] | null;
};

function ContentView() {
  const { t } = useI18n();
  const { moduleId, contentId } = Route.useParams();
  const [c, setC] = useState<Content | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [htmlUrl, setHtmlUrl] = useState<string>("");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const issueToken = useServerFn(issueModuleFileToken);

  const openFullscreen = () => {
    const el = frameRef.current;
    if (!el) return;
    const req = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).msRequestFullscreen;
    if (req) req.call(el);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("module_contents").select("id,kind,title,body,file_path,quiz").eq("id", contentId).maybeSingle();
      const item = data as unknown as Content | null;
      setC(item);
      if (item?.file_path) {
        if (item.kind === "html") {
          try {
            const { token, entry } = await issueToken({ data: { contentId } });
            setHtmlUrl(`/api/mf/${token}/${entry}`);
          } catch { setHtmlUrl(""); }
        } else {
          const { data: signed } = await supabase.storage.from("module-files").createSignedUrl(item.file_path, 3600);
          setFileUrl(signed?.signedUrl ?? "");
        }
      }
    })();
  }, [contentId, issueToken]);

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="border-b shrink-0"><div className="mx-auto max-w-6xl w-full px-4 md:px-6 py-2 md:py-3">
        <Button asChild variant="ghost" size="sm"><Link to="/modules/$moduleId/cours" params={{ moduleId }}><ArrowLeft className="mr-1.5 h-4 w-4" />{t("back_to_courses")}</Link></Button>
      </div></header>
      <main className="mx-auto max-w-6xl w-full px-4 md:px-6 py-2 md:py-4 flex-1 min-h-0 flex flex-col">
        <h1 className="text-lg md:text-2xl font-semibold mb-2 shrink-0 truncate">{c?.title ?? "…"}</h1>
        {c?.kind === "html" && (
          htmlUrl ? (
            <HtmlViewer url={htmlUrl} title={c.title} contentId={contentId} tFullscreen={t("fullscreen")} />
          ) : (
            <div className="flex-1 min-h-0 w-full rounded-lg border flex items-center justify-center text-muted-foreground">{t("loading_dots")}</div>
          )
        )}
        {c?.kind === "pdf" && fileUrl && (
          <div className="relative flex-1 min-h-0 w-full">
            <iframe ref={frameRef} src={fileUrl} title={c.title} className="h-full w-full rounded-lg border" />
            <Button onClick={openFullscreen} size="sm" variant="secondary" className="absolute top-2 right-2 shadow">
              <Maximize2 className="h-4 w-4 mr-1.5" />{t("fullscreen")}
            </Button>
          </div>
        )}
        {c?.kind === "richtext" && (
          <Card><CardContent className="prose prose-sm dark:prose-invert max-w-none py-6 whitespace-pre-wrap">{c.body}</CardContent></Card>
        )}
        {c?.kind === "link" && c.body && (
          <div className="relative flex-1 min-h-0 w-full">
            <iframe
              ref={frameRef}
              src={c.body}
              title={c.title}
              className="h-full w-full rounded-lg border bg-background"
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
            />
            <div className="absolute top-2 right-2 flex gap-2">
              <Button asChild size="sm" variant="secondary" className="shadow">
                <a href={c.body} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1.5" />{t("open_in_new_tab")}
                </a>
              </Button>
              <Button onClick={openFullscreen} size="sm" variant="secondary" className="shadow">
                <Maximize2 className="h-4 w-4 mr-1.5" />{t("fullscreen")}
              </Button>
            </div>
          </div>
        )}
        {c?.kind === "quiz" && c.quiz && <QuizRunner items={c.quiz} tValidate={t("validate")} tRestart={t("restart")} />}
      </main>
    </div>
  );
}

function HtmlViewer({ url, title, contentId, tFullscreen }: { url: string; title: string; contentId: string; tFullscreen: string }) {
  const { tr } = useI18n();
  const storageKey = `html-viewer:${contentId}`;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [loaded, setLoaded] = useState(false);

  // Restore prefs
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const p = JSON.parse(raw) as { zoom?: number };
        if (typeof p.zoom === "number") setZoom(clamp(p.zoom, 0.25, 3));
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  // Persist prefs
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify({ zoom })); } catch { /* ignore */ }
  }, [storageKey, zoom]);

  const openFullscreen = () => {
    const el = frameRef.current; if (!el) return;
    const req = el.requestFullscreen || (el as any).webkitRequestFullscreen || (el as any).msRequestFullscreen;
    if (req) req.call(el);
  };

  const pct = Math.round(zoom * 100);

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0 w-full overflow-auto rounded-lg border">
      {/*
        Uploaded lesson HTML is untrusted (any account with manage_content can
        upload it). The iframe is sandboxed WITHOUT allow-same-origin so scripts
        inside cannot read the app's cookies, localStorage or session tokens.
        Because of that isolation, zoom is applied to the frame element itself
        rather than to the inner document.
      */}
      <iframe
        ref={frameRef}
        src={url}
        title={title}
        onLoad={() => setLoaded(true)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        referrerPolicy="no-referrer"
        className="block border-0 bg-background"
        style={{
          width: `${100 / zoom}%`,
          height: `${100 / zoom}%`,
          minHeight: `${100 / zoom}%`,
          transform: `scale(${zoom})`,
          transformOrigin: "0 0",
        }}
      />
      {loaded && (
        <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full border bg-background/90 backdrop-blur px-1.5 py-1 shadow">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => clamp(+(z - 0.1).toFixed(2), 0.25, 3))} aria-label="Zoom -"><Minus className="h-3.5 w-3.5" /></Button>
          <button onClick={() => setZoom(1)} className="text-xs font-medium tabular-nums px-1.5 min-w-[3ch]" aria-label={tr("Réinitialiser")}>{pct}%</button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setZoom((z) => clamp(+(z + 0.1).toFixed(2), 0.25, 3))} aria-label="Zoom +"><Plus className="h-3.5 w-3.5" /></Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={openFullscreen} title={tFullscreen} aria-label={tFullscreen}><Maximize2 className="h-3.5 w-3.5" /></Button>
        </div>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }

function QuizRunner({ items, tValidate, tRestart }: { items: QuizItem[]; tValidate: string; tRestart: string }) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const score = items.reduce((s, q, i) => s + (answers[i] === q.answer ? 1 : 0), 0);

  return (
    <div className="space-y-4">
      {items.map((q, i) => (
        <Card key={i}>
          <CardHeader><CardTitle className="text-base">{i + 1}. {q.q}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {q.choices.map((ch, j) => {
              const chosen = answers[i] === j;
              const correct = submitted && j === q.answer;
              const wrong = submitted && chosen && j !== q.answer;
              return (
                <button key={j} disabled={submitted} onClick={() => setAnswers({ ...answers, [i]: j })}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition
                    ${chosen ? "border-primary" : "border-border"} ${correct ? "bg-green-500/10 border-green-500" : ""} ${wrong ? "bg-red-500/10 border-red-500" : ""}`}>
                  {correct && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {wrong && <XCircle className="h-4 w-4 text-red-600" />}
                  <span>{ch}</span>
                </button>
              );
            })}
            {submitted && q.explanation && <p className="text-xs text-muted-foreground pt-2">{q.explanation}</p>}
          </CardContent>
        </Card>
      ))}
      {!submitted ? (
        <Button onClick={() => setSubmitted(true)} disabled={Object.keys(answers).length !== items.length}>{tValidate}</Button>
      ) : (
        <Card><CardContent className="py-6 text-center">
          <p className="text-2xl font-semibold">{score} / {items.length}</p>
          <Button variant="ghost" size="sm" onClick={() => { setAnswers({}); setSubmitted(false); }}>{tRestart}</Button>
        </CardContent></Card>
      )}
    </div>
  );
}