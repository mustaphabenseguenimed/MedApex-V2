import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { issueModuleFileToken } from "@/lib/moduleFile.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  ExternalLink,
  ArrowLeftRight,
} from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ModuleScopeGate } from "@/lib/scopes";
import { cn } from "@/lib/utils";

// Reading width for html lessons, in px. Not every résumé ships its own
// width control, so the app provides one for all of them; HTML_WIDTH_MAX
// means "no limit" and is where the old binary "largeur maximale" toggle
// lands when migrated.
const HTML_WIDTH_MIN = 720;
const HTML_WIDTH_DEFAULT = 1152; // matches the max-w-6xl used for everything else
const HTML_WIDTH_MAX = 2400;
const HTML_WIDTH_STEP = 48;

export const Route = createFileRoute("/_authenticated/modules/$moduleId/$contentId")({
  component: ContentGate,
});

function ContentGate() {
  const { moduleId } = Route.useParams();
  return (
    <ModuleScopeGate moduleId={moduleId} scope="lessons">
      <ContentView />
    </ModuleScopeGate>
  );
}

type QuizItem = { q: string; choices: string[]; answer: number; explanation?: string };
type Content = {
  id: string;
  kind: "html" | "pdf" | "richtext" | "quiz" | "link";
  title: string;
  body: string | null;
  file_path: string | null;
  quiz: QuizItem[] | null;
};

function ContentView() {
  const { t, tr } = useI18n();
  const { moduleId, contentId } = Route.useParams();
  const [c, setC] = useState<Content | null>(null);
  const [fileUrl, setFileUrl] = useState<string>("");
  const [htmlUrl, setHtmlUrl] = useState<string>("");
  const [htmlZoom, setHtmlZoom] = useState(1);
  // Reading width, in px. HTML_WIDTH_MAX means "no limit" — the old boolean
  // "largeur maximale" toggle is migrated onto this scale on first read.
  const [htmlWidth, setHtmlWidth] = useState(HTML_WIDTH_DEFAULT);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const issueToken = useServerFn(issueModuleFileToken);

  // Restore/persist the html viewer's zoom + width prefs per lesson (same
  // storage key the viewer used before this was lifted up here so the width
  // control can also resize the page's own <main>).
  useEffect(() => {
    if (!contentId) return;
    try {
      const raw = localStorage.getItem(`html-viewer:${contentId}`);
      if (raw) {
        const p = JSON.parse(raw) as { zoom?: number; wide?: boolean; width?: number };
        if (typeof p.zoom === "number") setHtmlZoom(clamp(p.zoom, 0.25, 3));
        if (typeof p.width === "number") {
          setHtmlWidth(clamp(p.width, HTML_WIDTH_MIN, HTML_WIDTH_MAX));
        } else if (typeof p.wide === "boolean") {
          // Migrate the old binary toggle: "largeur maximale" was no limit.
          setHtmlWidth(p.wide ? HTML_WIDTH_MAX : HTML_WIDTH_DEFAULT);
        }
      }
    } catch {
      /* ignore */
    }
  }, [contentId]);

  useEffect(() => {
    if (!contentId) return;
    try {
      localStorage.setItem(
        `html-viewer:${contentId}`,
        JSON.stringify({ zoom: htmlZoom, width: htmlWidth }),
      );
    } catch {
      /* ignore */
    }
  }, [contentId, htmlZoom, htmlWidth]);

  // PDF and link viewers are mutually exclusive, so one container ref serves
  // whichever is on screen.
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const { isFullscreen, isPseudoFullscreen, toggle } = useViewerFullscreen(
    frameRef,
    viewerContainerRef,
  );

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("module_contents")
        .select("id,kind,title,body,file_path,quiz")
        .eq("id", contentId)
        .maybeSingle();
      const item = data as unknown as Content | null;
      setC(item);
      if (item?.file_path) {
        if (item.kind === "html") {
          try {
            const { token, entry } = await issueToken({ data: { contentId } });
            setHtmlUrl(`/api/mf/${token}/${entry}`);
          } catch {
            setHtmlUrl("");
          }
        } else {
          const { data: signed } = await supabase.storage
            .from("module-files")
            .createSignedUrl(item.file_path, 3600);
          setFileUrl(signed?.signedUrl ?? "");
        }
      }
    })();
  }, [contentId, issueToken]);

  return (
    <div className="h-[100dvh] bg-background flex flex-col overflow-hidden">
      <header className="border-b shrink-0">
        <div className="mx-auto max-w-6xl w-full px-4 md:px-6 py-2 md:py-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/modules/$moduleId/cours" params={{ moduleId }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("back_to_courses")}
            </Link>
          </Button>
        </div>
      </header>
      <main
        className={cn(
          "mx-auto w-full px-4 md:px-6 py-2 md:py-4 flex-1 min-h-0 flex flex-col",
          c?.kind !== "html" && "max-w-6xl",
        )}
        style={
          c?.kind === "html"
            ? { maxWidth: htmlWidth >= HTML_WIDTH_MAX ? "none" : `${htmlWidth}px` }
            : undefined
        }
      >
        <h1 className="text-lg md:text-2xl font-semibold mb-2 shrink-0 truncate">
          {c?.title ?? "…"}
        </h1>
        {c?.kind === "html" &&
          (htmlUrl ? (
            <HtmlViewer
              url={htmlUrl}
              title={c.title}
              tFullscreen={t("fullscreen")}
              zoom={htmlZoom}
              onZoomChange={setHtmlZoom}
              width={htmlWidth}
              onWidthChange={setHtmlWidth}
            />
          ) : (
            <div className="flex-1 min-h-0 w-full rounded-lg border flex items-center justify-center text-muted-foreground">
              {t("loading_dots")}
            </div>
          ))}
        {c?.kind === "pdf" && fileUrl && (
          <div
            ref={viewerContainerRef}
            className={cn(
              "relative flex-1 min-h-0 w-full",
              isPseudoFullscreen && `${PSEUDO_FULLSCREEN_CLASS} bg-background`,
            )}
          >
            <iframe
              ref={frameRef}
              src={fileUrl}
              title={c.title}
              className="h-full w-full rounded-lg border"
            />
            <Button
              onClick={toggle}
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2 shadow"
            >
              {isFullscreen ? (
                <Minimize2 className="h-4 w-4 mr-1.5" />
              ) : (
                <Maximize2 className="h-4 w-4 mr-1.5" />
              )}
              {isFullscreen ? tr("Quitter le plein écran") : t("fullscreen")}
            </Button>
          </div>
        )}
        {c?.kind === "richtext" && (
          <Card>
            <CardContent className="prose prose-sm dark:prose-invert max-w-none py-6 whitespace-pre-wrap">
              {c.body}
            </CardContent>
          </Card>
        )}
        {c?.kind === "link" && c.body && (
          <div
            ref={viewerContainerRef}
            className={cn(
              "relative flex-1 min-h-0 w-full",
              isPseudoFullscreen && `${PSEUDO_FULLSCREEN_CLASS} bg-background`,
            )}
          >
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
                  <ExternalLink className="h-4 w-4 mr-1.5" />
                  {t("open_in_new_tab")}
                </a>
              </Button>
              <Button onClick={toggle} size="sm" variant="secondary" className="shadow">
                {isFullscreen ? (
                  <Minimize2 className="h-4 w-4 mr-1.5" />
                ) : (
                  <Maximize2 className="h-4 w-4 mr-1.5" />
                )}
                {isFullscreen ? tr("Quitter le plein écran") : t("fullscreen")}
              </Button>
            </div>
          </div>
        )}
        {c?.kind === "quiz" && c.quiz && (
          <QuizRunner items={c.quiz} tValidate={t("validate")} tRestart={t("restart")} />
        )}
      </main>
    </div>
  );
}

function HtmlViewer({
  url,
  title,
  tFullscreen,
  zoom,
  onZoomChange,
  width,
  onWidthChange,
}: {
  url: string;
  title: string;
  tFullscreen: string;
  zoom: number;
  onZoomChange: (updater: (z: number) => number) => void;
  width: number;
  onWidthChange: (w: number) => void;
}) {
  const { tr } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState(false);

  const { isFullscreen, isPseudoFullscreen, toggle } = useViewerFullscreen(frameRef, containerRef);

  const pct = Math.round(zoom * 100);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex-1 min-h-0 w-full overflow-auto rounded-lg border bg-background",
        isPseudoFullscreen && PSEUDO_FULLSCREEN_CLASS,
      )}
    >
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
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onZoomChange((z) => clamp(+(z - 0.1).toFixed(2), 0.25, 3))}
            aria-label="Zoom -"
          >
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <button
            onClick={() => onZoomChange(() => 1)}
            className="text-xs font-medium tabular-nums px-1.5 min-w-[3ch]"
            aria-label={tr("Réinitialiser")}
          >
            {pct}%
          </button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onZoomChange((z) => clamp(+(z + 0.1).toFixed(2), 0.25, 3))}
            aria-label="Zoom +"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => onWidthChange(HTML_WIDTH_DEFAULT)}
            title={tr("Largeur par défaut")}
            aria-label={tr("Largeur par défaut")}
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
          </Button>
          <input
            type="range"
            min={HTML_WIDTH_MIN}
            max={HTML_WIDTH_MAX}
            step={HTML_WIDTH_STEP}
            value={width}
            onChange={(e) => onWidthChange(Number(e.target.value))}
            className="h-7 w-16 md:w-24 cursor-pointer accent-primary"
            title={tr("Largeur de lecture")}
            aria-label={tr("Largeur de lecture")}
          />
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            size="icon"
            variant={isFullscreen ? "secondary" : "ghost"}
            className="h-7 w-7"
            onClick={toggle}
            title={isFullscreen ? tr("Quitter le plein écran") : tFullscreen}
            aria-label={isFullscreen ? tr("Quitter le plein écran") : tFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Full screen for a viewer, with a fallback for browsers that have no
 * Fullscreen API.
 *
 * iPhone is the reason this isn't just `requestFullscreen()`: iOS exposes
 * the Fullscreen API on iPad but NOT on iPhone, where the only way in is
 * `HTMLVideoElement.webkitEnterFullscreen()` — no use here, the target is an
 * iframe. Every browser on iOS is WebKit, so Chrome and Firefox behave the
 * same. The old code probed the three vendor methods and did nothing when
 * none existed, which is why the button was silently dead on iPhone.
 *
 * So: use the real thing where it exists (desktop, Android — unchanged), and
 * otherwise fill the viewport with CSS. That is as far as a web page can go
 * on iPhone; Safari's own address and tab bars cannot be removed by a site.
 */
function useViewerFullscreen(
  targetRef: React.RefObject<Element | null>,
  containerRef: React.RefObject<HTMLElement | null>,
) {
  const [pseudo, setPseudo] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const sync = () => {
      const el = document.fullscreenElement ?? (document as any).webkitFullscreenElement ?? null;
      setNative(!!el && el === targetRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [targetRef]);

  // Pseudo-fullscreen covers the page, so the page behind it must not scroll.
  useEffect(() => {
    if (!pseudo) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPseudo(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [pseudo]);

  const isFullscreen = native || pseudo;

  const toggle = () => {
    if (pseudo) {
      setPseudo(false);
      return;
    }
    if (native) {
      const exit = document.exitFullscreen ?? (document as any).webkitExitFullscreen;
      if (exit) Promise.resolve(exit.call(document)).catch(() => setNative(false));
      return;
    }
    const el = targetRef.current as any;
    const req = el?.requestFullscreen ?? el?.webkitRequestFullscreen ?? el?.msRequestFullscreen;
    if (!req) {
      // No Fullscreen API at all — the iPhone case.
      setPseudo(!!containerRef.current);
      return;
    }
    // A rejection (e.g. a permissions policy blocking it) should still give
    // the user something, rather than an unhandled promise rejection.
    Promise.resolve(req.call(el)).catch(() => setPseudo(!!containerRef.current));
  };

  return { isFullscreen, isPseudoFullscreen: pseudo, toggle };
}

/** Classes that turn a viewer container into a viewport-filling panel when
 *  the browser can't do it natively. 100dvh, not 100vh: iOS Safari's toolbars
 *  collapse, and 100vh would run underneath them. */
const PSEUDO_FULLSCREEN_CLASS = "fixed inset-0 z-50 h-[100dvh] w-screen rounded-none border-0";

function QuizRunner({
  items,
  tValidate,
  tRestart,
}: {
  items: QuizItem[];
  tValidate: string;
  tRestart: string;
}) {
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const score = items.reduce((s, q, i) => s + (answers[i] === q.answer ? 1 : 0), 0);

  return (
    <div className="space-y-4">
      {items.map((q, i) => (
        <Card key={i}>
          <CardHeader>
            <CardTitle className="text-base">
              {i + 1}. {q.q}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {q.choices.map((ch, j) => {
              const chosen = answers[i] === j;
              const correct = submitted && j === q.answer;
              const wrong = submitted && chosen && j !== q.answer;
              return (
                <button
                  key={j}
                  disabled={submitted}
                  onClick={() => setAnswers({ ...answers, [i]: j })}
                  className={`flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition
                    ${chosen ? "border-primary" : "border-border"} ${correct ? "bg-green-500/10 border-green-500" : ""} ${wrong ? "bg-red-500/10 border-red-500" : ""}`}
                >
                  {correct && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                  {wrong && <XCircle className="h-4 w-4 text-red-600" />}
                  <span>{ch}</span>
                </button>
              );
            })}
            {submitted && q.explanation && (
              <p className="text-xs text-muted-foreground pt-2">{q.explanation}</p>
            )}
          </CardContent>
        </Card>
      ))}
      {!submitted ? (
        <Button
          onClick={() => setSubmitted(true)}
          disabled={Object.keys(answers).length !== items.length}
        >
          {tValidate}
        </Button>
      ) : (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-2xl font-semibold">
              {score} / {items.length}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAnswers({});
                setSubmitted(false);
              }}
            >
              {tRestart}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
