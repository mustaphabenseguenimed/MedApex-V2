import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Loader2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { useAdminPermissions } from "@/hooks/use-permissions";
import { useI18n } from "@/lib/i18n";
import {
  prepareDocxChunks,
  extractQuestionsFromHtmlChunk,
  extractQuestionsFromPdfChunk,
  type ExtractedQ,
} from "@/lib/questions.functions";
import {
  extractDocxPlainText,
  generateQuestionsDocx,
  generateGroundedExplanations,
} from "@/lib/conversion.functions";
import type { DocxQuestionItem } from "@/lib/questionsDocxBuilder";
import { readAsDataUrl, splitPdfIntoPageChunks } from "@/lib/fileUtils";
import { downloadBase64, downloadText } from "@/lib/download";

export const Route = createFileRoute("/_authenticated/admin/convert")({
  head: () => ({ meta: [{ title: "Conversion — Admin" }] }),
  component: ConvertAdmin,
});

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// ---- shared helpers ---------------------------------------------------------

function caseKey(q: { case_stem?: string | null }): string {
  return (q.case_stem ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripHtml(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** "Rotation" and "Year" are written as one combined "Rotation : Pn <year>"
 *  line in the generated .docx (per spec), so on the way in we merge the two
 *  hints into a single string. */
function combinedRotation(q: ExtractedQ): string | null {
  const parts = [q.rotation_hint, q.year_hint].filter(Boolean) as string[];
  return parts.length ? parts.join(" ") : null;
}

/** On the way back out (reading a generated .docx), the combined rotation
 *  line usually lands entirely in rotation_hint with year_hint left null —
 *  split it back into separate "Rotation"/"Year" values for the JSON step. */
function splitRotationYear(q: ExtractedQ): { rotation: string; year: string } {
  if (q.year_hint) return { rotation: q.rotation_hint ?? "", year: q.year_hint };
  const raw = (q.rotation_hint ?? "").trim();
  if (!raw) return { rotation: "", year: "" };
  const m = raw.match(/^(\S+)\s+(.*)$/);
  return m ? { rotation: m[1], year: m[2].trim() } : { rotation: raw, year: "" };
}

function toDocxItems(qs: ExtractedQ[], rotationOverride?: string): DocxQuestionItem[] {
  return qs.map((q) => ({
    stem: q.stem,
    choices: q.choices,
    correct_indices: q.correct_indices,
    model_answer: q.model_answer,
    explanation: q.explanation,
    case_stem: q.case_stem,
    rotation_hint: rotationOverride?.trim() || combinedRotation(q),
  }));
}

function toJsonObjects(qs: ExtractedQ[]): unknown[] {
  const out: unknown[] = [];
  let i = 0;
  while (i < qs.length) {
    const key = caseKey(qs[i]);
    if (key) {
      const group: ExtractedQ[] = [];
      while (i < qs.length && caseKey(qs[i]) === key) {
        group.push(qs[i]);
        i++;
      }
      const { rotation, year } = splitRotationYear(group[0]);
      out.push({
        Rotation: rotation,
        Year: year,
        "cas clinique stem": stripHtml(key),
        questions: group.map((g) => ({
          stem: stripHtml(g.stem),
          choices: g.choices ? g.choices.map((c) => stripHtml(c)) : null,
          correct_indices: g.correct_indices ?? null,
          explanation: g.explanation ? stripHtml(g.explanation) : null,
        })),
      });
    } else {
      const q = qs[i];
      const { rotation, year } = splitRotationYear(q);
      out.push({
        Rotation: rotation,
        Year: year,
        stem: stripHtml(q.stem),
        choices: q.choices ? q.choices.map((c) => stripHtml(c)) : null,
        correct_indices: q.correct_indices ?? null,
        explanation: q.explanation ? stripHtml(q.explanation) : null,
      });
      i++;
    }
  }
  return out;
}

const EXPLAIN_BATCH_SIZE = 60;

/** Retry a network-level failure (dropped mobile connection mid-upload shows up
 *  as a bare "Failed to fetch" TypeError from the browser) with backoff. Server
 *  errors that actually reached the backend are not retried here — the server
 *  functions already retry AI-transient failures themselves. */
async function withRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      const isNetworkError =
        e instanceof TypeError || /failed to fetch|network/i.test(String(e?.message ?? ""));
      if (!isNetworkError || attempt >= retries) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

/** Friendlier message for a dropped connection than the raw "Failed to fetch". */
function friendlyError(e: any, tr: (s: string) => string): string {
  if (e instanceof TypeError || /failed to fetch/i.test(String(e?.message ?? ""))) {
    return tr("Connexion réseau instable — le fichier n'a pas pu être envoyé. Réessayez.");
  }
  return e?.message ?? tr("Échec de la conversion");
}

// ---- page shell -------------------------------------------------------------

function ConvertAdmin() {
  const { loading, isSuper, has } = useAdminPermissions();
  const { tr } = useI18n();
  if (loading) return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (!isSuper && !has("manage_quiz"))
    return (
      <div className="p-10 text-center text-muted-foreground">
        {tr("Permission requise : gestion du contenu.")}
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto max-w-4xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/admin">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {tr("Admin")}
            </Link>
          </Button>
          <h1 className="text-lg font-semibold">{tr("Conversion de questions")}</h1>
          <div />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-8">
        <Tabs defaultValue="step1">
          <TabsList>
            <TabsTrigger value="step1">{tr("1. PDF → DOCX")}</TabsTrigger>
            <TabsTrigger value="step2">{tr("2. + Explications")}</TabsTrigger>
            <TabsTrigger value="step3">{tr("3. → JSON")}</TabsTrigger>
          </TabsList>
          <TabsContent value="step1" className="mt-6">
            <Step1Panel />
          </TabsContent>
          <TabsContent value="step2" className="mt-6">
            <Step2Panel />
          </TabsContent>
          <TabsContent value="step3" className="mt-6">
            <Step3Panel />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ---- Step 1: PDF(s) → DOCX (no explanations) --------------------------------

function Step1Panel() {
  const { tr } = useI18n();
  const extractPdfChunk = useServerFn(extractQuestionsFromPdfChunk);
  const genDocx = useServerFn(generateQuestionsDocx);
  const [files, setFiles] = useState<File[]>([]);
  const [rotation, setRotation] = useState("");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const run = async () => {
    if (!files.length) {
      toast.error(tr("Ajoutez au moins un fichier PDF"));
      return;
    }
    setBusy(true);
    setCount(null);
    try {
      const chunkJobs: { dataUrl: string; filename: string }[] = [];
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        const chunks = await splitPdfIntoPageChunks(bytes, 3);
        for (const chunk of chunks) {
          chunkJobs.push({ dataUrl: chunk.dataUrl, filename: `${file.name} (${chunk.label})` });
        }
      }
      // Fire every PDF chunk at once instead of one at a time — this is the
      // main driver of wall-clock time for a multi-page/multi-file upload.
      // Each chunk also retries on a dropped connection (common on mobile).
      const parts = await Promise.all(
        chunkJobs.map((job) =>
          withRetry(() =>
            extractPdfChunk({
              data: { pdfDataUrl: job.dataUrl, filename: job.filename, detectCases: true },
            }),
          ).then((r) => r.questions ?? []),
        ),
      );
      const all: ExtractedQ[] = parts.flat();
      if (!all.length) throw new Error(tr("Aucune question détectée"));
      const items = toDocxItems(all, rotation);
      const { base64 } = await withRetry(() =>
        genDocx({ data: { items, includeExplanations: false } }),
      );
      downloadBase64(`questions_${Date.now()}.docx`, base64, DOCX_MIME);
      setCount(all.length);
      toast.success(`${all.length} ${tr("question(s) converties")}`);
    } catch (e: any) {
      toast.error(friendlyError(e, tr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tr("Convertir des PDF (captures de questions) en fichier Word")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{tr("Fichiers PDF")}</Label>
          <Input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
          />
          {files.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {files.length} {tr("fichier(s) sélectionné(s)")}
            </p>
          )}
        </div>
        <div>
          <Label>{tr("Rotation (optionnel — appliquée à toutes les questions)")}</Label>
          <Input
            placeholder={tr("ex. P3 2010")}
            value={rotation}
            onChange={(e) => setRotation(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            {tr("Laissez vide pour garder la rotation détectée automatiquement par question.")}
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-1.5 h-4 w-4" />
          )}
          {tr("Générer le .docx")}
        </Button>
        {count != null && (
          <p className="text-sm text-muted-foreground">
            {count} {tr("question(s) écrites dans le fichier téléchargé.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Step 2: DOCX + reference file → DOCX with explanations -----------------

function Step2Panel() {
  const { tr } = useI18n();
  const prepDocx = useServerFn(prepareDocxChunks);
  const extractHtml = useServerFn(extractQuestionsFromHtmlChunk);
  const extractDocxText = useServerFn(extractDocxPlainText);
  const genExplanations = useServerFn(generateGroundedExplanations);
  const genDocx = useServerFn(generateQuestionsDocx);

  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [refMode, setRefMode] = useState<"pdf" | "docx" | "text">("text");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [refText, setRefText] = useState("");
  const [allowNoAi, setAllowNoAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const run = async () => {
    if (!docxFile) {
      toast.error(tr("Ajoutez un fichier .docx (étape 1)"));
      return;
    }
    setBusy(true);
    setCount(null);
    try {
      const dataUrl = await readAsDataUrl(docxFile);
      const { chunks } = await withRetry(() =>
        prepDocx({ data: { docxDataUrl: dataUrl, detectCases: true } }),
      );
      if (!chunks.length) throw new Error(tr("Fichier vide ou illisible"));
      const parts = await Promise.all(
        chunks.map((c) =>
          withRetry(() =>
            extractHtml({
              data: {
                html: c.html,
                colorHint: c.colorHint,
                expected: c.expected,
                allowNoAi,
                detectCases: true,
              },
            }),
          ).then((r) =>
            (r.questions ?? []).map((q, i) => {
              const ctx = c.contexts[i];
              if (!ctx) return q;
              return {
                ...q,
                year_hint: ctx.year_hint ?? q.year_hint,
                rotation_hint: ctx.rotation_hint ?? q.rotation_hint,
                course_hint: ctx.course_hint ?? q.course_hint,
                case_stem: ctx.case_stem ?? q.case_stem,
              };
            }),
          ),
        ),
      );
      const qs: ExtractedQ[] = parts.flat();
      if (!qs.length) throw new Error(tr("Aucune question détectée"));

      let referenceText: string | undefined;
      if (refMode === "text") {
        referenceText = refText.trim() || undefined;
      } else if (refMode === "pdf" && refFile) {
        const { extractPdfText } = await import("@/lib/pdfText");
        const bytes = await refFile.arrayBuffer();
        const { pages } = await extractPdfText(bytes);
        referenceText = pages.join("\n");
      } else if (refMode === "docx" && refFile) {
        const refDataUrl = await readAsDataUrl(refFile);
        const { text } = await withRetry(() =>
          extractDocxText({ data: { docxDataUrl: refDataUrl } }),
        );
        referenceText = text;
      }

      // Batches run in parallel — sequential batches were the main bottleneck
      // for documents with more than EXPLAIN_BATCH_SIZE questions.
      const batches: ExtractedQ[][] = [];
      for (let i = 0; i < qs.length; i += EXPLAIN_BATCH_SIZE) {
        batches.push(qs.slice(i, i + EXPLAIN_BATCH_SIZE));
      }
      const explanationParts = await Promise.all(
        batches.map((batch) =>
          withRetry(() =>
            genExplanations({
              data: {
                items: batch.map((q) => ({
                  stem: q.stem,
                  choices: q.choices,
                  correct_indices: q.correct_indices,
                  model_answer: q.model_answer,
                })),
                referenceText,
              },
            }),
          ).then((r) => r.explanations),
        ),
      );
      const explanations = explanationParts.flat();
      const withExplanations = qs.map((q, i) => ({
        ...q,
        explanation: explanations[i] ?? q.explanation,
      }));

      const items = toDocxItems(withExplanations);
      const { base64 } = await withRetry(() =>
        genDocx({ data: { items, includeExplanations: true } }),
      );
      downloadBase64(`questions_explications_${Date.now()}.docx`, base64, DOCX_MIME);
      setCount(qs.length);
      toast.success(`${qs.length} ${tr("question(s) traitées")}`);
    } catch (e: any) {
      toast.error(friendlyError(e, tr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {tr("Ajouter des explications à un fichier Word de questions")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{tr("Fichier .docx (questions, sans explications)")}</Label>
          <Input
            type="file"
            accept={`.docx,${DOCX_MIME}`}
            onChange={(e) => setDocxFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="step2-noai" checked={allowNoAi} onCheckedChange={setAllowNoAi} />
          <Label htmlFor="step2-noai" className="cursor-pointer">
            {tr("Mode sans IA pour la lecture du .docx (gratuit, un seul fichier par rotation)")}
          </Label>
        </div>
        <div>
          <Label>{tr("Document de référence (source des explications)")}</Label>
          <Select value={refMode} onValueChange={(v) => setRefMode(v as typeof refMode)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="text">{tr("Texte collé")}</SelectItem>
              <SelectItem value="pdf">{tr("Fichier PDF")}</SelectItem>
              <SelectItem value="docx">{tr("Fichier Word")}</SelectItem>
            </SelectContent>
          </Select>
          {refMode === "text" ? (
            <Textarea
              className="mt-2"
              rows={6}
              placeholder={tr("Collez ici le contenu du cours / document de référence…")}
              value={refText}
              onChange={(e) => setRefText(e.target.value)}
            />
          ) : (
            <Input
              className="mt-2"
              type="file"
              accept={refMode === "pdf" ? "application/pdf,.pdf" : `.docx,${DOCX_MIME}`}
              onChange={(e) => setRefFile(e.target.files?.[0] ?? null)}
            />
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(
              "Optionnel : laissez vide pour générer les explications à partir des connaissances générales de l'IA.",
            )}
          </p>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-1.5 h-4 w-4" />
          )}
          {tr("Générer le .docx avec explications")}
        </Button>
        {count != null && (
          <p className="text-sm text-muted-foreground">
            {count} {tr("question(s) écrites dans le fichier téléchargé.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Step 3: DOCX → JSON -----------------------------------------------------

function Step3Panel() {
  const { tr } = useI18n();
  const prepDocx = useServerFn(prepareDocxChunks);
  const extractHtml = useServerFn(extractQuestionsFromHtmlChunk);
  const [docxFile, setDocxFile] = useState<File | null>(null);
  const [allowNoAi, setAllowNoAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);

  const run = async () => {
    if (!docxFile) {
      toast.error(tr("Ajoutez un fichier .docx (étape 1 ou 2)"));
      return;
    }
    setBusy(true);
    setCount(null);
    try {
      const dataUrl = await readAsDataUrl(docxFile);
      const { chunks } = await withRetry(() =>
        prepDocx({ data: { docxDataUrl: dataUrl, detectCases: true } }),
      );
      if (!chunks.length) throw new Error(tr("Fichier vide ou illisible"));
      const parts = await Promise.all(
        chunks.map((c) =>
          withRetry(() =>
            extractHtml({
              data: {
                html: c.html,
                colorHint: c.colorHint,
                expected: c.expected,
                allowNoAi,
                detectCases: true,
              },
            }),
          ).then((r) =>
            (r.questions ?? []).map((q, i) => {
              const ctx = c.contexts[i];
              if (!ctx) return q;
              return {
                ...q,
                year_hint: ctx.year_hint ?? q.year_hint,
                rotation_hint: ctx.rotation_hint ?? q.rotation_hint,
                course_hint: ctx.course_hint ?? q.course_hint,
                case_stem: ctx.case_stem ?? q.case_stem,
              };
            }),
          ),
        ),
      );
      const qs: ExtractedQ[] = parts.flat();
      if (!qs.length) throw new Error(tr("Aucune question détectée"));
      const objects = toJsonObjects(qs);
      downloadText(`questions_${Date.now()}.json`, JSON.stringify(objects, null, 2));
      setCount(qs.length);
      toast.success(`${qs.length} ${tr("question(s) converties en JSON")}`);
    } catch (e: any) {
      toast.error(friendlyError(e, tr));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{tr("Convertir un fichier Word en JSON")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>{tr("Fichier .docx (questions, avec ou sans explications)")}</Label>
          <Input
            type="file"
            accept={`.docx,${DOCX_MIME}`}
            onChange={(e) => setDocxFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="step3-noai" checked={allowNoAi} onCheckedChange={setAllowNoAi} />
          <Label htmlFor="step3-noai" className="cursor-pointer">
            {tr("Mode sans IA pour la lecture du .docx (gratuit, un seul fichier par rotation)")}
          </Label>
        </div>
        <Button onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <FileDown className="mr-1.5 h-4 w-4" />
          )}
          {tr("Générer le .json")}
        </Button>
        {count != null && (
          <p className="text-sm text-muted-foreground">
            {count} {tr("question(s) écrites dans le fichier téléchargé.")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
