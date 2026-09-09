import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ArrowRight, Download, Eye, History, Loader2, Pencil, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useConfirm, usePromptDialog } from "@/hooks/use-confirm";
import { useI18n } from "@/lib/i18n";
import { base64ToFile, baseFilename, downloadBase64, downloadText } from "@/lib/download";
import { extractDocxPlainText } from "@/lib/conversion.functions";
import {
  deleteConversionLibraryItem,
  getConversionLibraryItemContent,
  listConversionLibraryItems,
  renameConversionLibraryItem,
  saveConversionLibraryItem,
} from "@/lib/conversionLibrary.functions";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

type OutputKind = "docx" | "json";

type LibraryItem = {
  id: string;
  step: number;
  created_at: string;
  source_filenames: string[];
  label: string;
  output_kind: OutputKind;
  item_count: number | null;
};

/** Button placed next to a step's own download button: saves the result the
 *  admin is looking at right now into the shared conversion library, asking
 *  for a name first. */
export function SaveToLibraryButton({
  step,
  sourceFilenames,
  outputKind,
  content,
  getContent,
  itemCount,
  moduleId,
  rotation,
  yearLabel,
  defaultLabel,
  onSaved,
}: {
  step: 1 | 2 | 3 | 4;
  sourceFilenames: string[];
  outputKind: OutputKind;
  /** Either the content directly, or a lazy loader for it — for a step
   *  (like step 4) whose output isn't generated until the admin asks for it. */
  content?: string;
  getContent?: () => Promise<string>;
  itemCount?: number | null;
  moduleId?: string | null;
  rotation?: string | null;
  yearLabel?: string | null;
  defaultLabel?: string;
  onSaved?: () => void;
}) {
  const { tr } = useI18n();
  const saveFn = useServerFn(saveConversionLibraryItem);
  const promptDialog = usePromptDialog();
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const suggested = defaultLabel ?? baseFilename(sourceFilenames[0] ?? "fichier");
    const label = await promptDialog(tr("Nom pour la bibliothèque"), suggested, {
      title: tr("Enregistrer dans la bibliothèque"),
      confirmLabel: tr("Enregistrer"),
    });
    if (!label || !label.trim()) return;
    setBusy(true);
    try {
      const resolvedContent = content ?? (await getContent?.());
      if (!resolvedContent) throw new Error(tr("Rien à enregistrer"));
      await saveFn({
        data: {
          step,
          sourceFilenames,
          label: label.trim(),
          outputKind,
          content: resolvedContent,
          itemCount: itemCount ?? null,
          moduleId: moduleId ?? null,
          rotation: rotation ?? null,
          yearLabel: yearLabel ?? null,
        },
      });
      toast.success(tr("Enregistré dans la bibliothèque"));
      onSaved?.();
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={save} disabled={busy}>
      {busy ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-1.5 h-4 w-4" />
      )}
      {tr("Enregistrer dans la bibliothèque")}
    </Button>
  );
}

/** A step's history section: past library entries, with actions to preview,
 *  download, rename, delete, and (when `onContinue` is given) hand a past
 *  result straight to the next step, exactly like a fresh "Continuer". */
export function ConversionLibrary({
  step,
  refreshKey,
  onContinue,
}: {
  step: 1 | 2 | 3 | 4;
  refreshKey?: number;
  onContinue?: (file: File, srcKind: OutputKind) => void;
}) {
  const { tr } = useI18n();
  const listFn = useServerFn(listConversionLibraryItems);
  const contentFn = useServerFn(getConversionLibraryItemContent);
  const renameFn = useServerFn(renameConversionLibraryItem);
  const deleteFn = useServerFn(deleteConversionLibraryItem);
  const extractText = useServerFn(extractDocxPlainText);
  const confirm = useConfirm();
  const promptDialog = usePromptDialog();

  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ label: string; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFn({ data: { step } })
      .then(({ items }) => {
        if (!cancelled) setItems(items as LibraryItem[]);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, refreshKey]);

  const show = async (item: LibraryItem) => {
    setBusyId(item.id);
    try {
      const { content, outputKind } = await contentFn({ data: { id: item.id } });
      if (outputKind === "docx") {
        const { text } = await extractText({
          data: { docxDataUrl: `data:${DOCX_MIME};base64,${content}` },
        });
        setPreview({ label: item.label, text: text.trim() || tr("(vide)") });
      } else {
        let text = content;
        try {
          const parsed = JSON.parse(content);
          const arr: any[] = Array.isArray(parsed) ? parsed : (parsed.objects ?? []);
          text = arr
            .map(
              (q, i) => `${i + 1}. ${String(q.stem ?? q.case_stem ?? "").replace(/<[^>]+>/g, " ")}`,
            )
            .join("\n\n");
        } catch {
          // Not parseable as the app's own question shape — show it raw.
        }
        setPreview({ label: item.label, text: text.trim() || tr("(vide)") });
      }
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally {
      setBusyId(null);
    }
  };

  const download = async (item: LibraryItem) => {
    setBusyId(item.id);
    try {
      const { content, outputKind, label } = await contentFn({ data: { id: item.id } });
      if (outputKind === "docx") downloadBase64(`${label}.docx`, content, DOCX_MIME);
      else downloadText(`${label}.json`, content);
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally {
      setBusyId(null);
    }
  };

  const doContinue = async (item: LibraryItem) => {
    if (!onContinue) return;
    setBusyId(item.id);
    try {
      const { content, outputKind, label } = await contentFn({ data: { id: item.id } });
      const file =
        outputKind === "docx"
          ? base64ToFile(`${label}.docx`, content, DOCX_MIME)
          : new File([content], `${label}.json`, { type: "application/json" });
      onContinue(file, outputKind);
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    } finally {
      setBusyId(null);
    }
  };

  const rename = async (item: LibraryItem) => {
    const next = await promptDialog(tr("Nouveau nom"), item.label, { title: tr("Renommer") });
    if (!next || !next.trim() || next.trim() === item.label) return;
    try {
      await renameFn({ data: { id: item.id, label: next.trim() } });
      setItems((prev) =>
        prev ? prev.map((it) => (it.id === item.id ? { ...it, label: next.trim() } : it)) : prev,
      );
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    }
  };

  const remove = async (item: LibraryItem) => {
    const ok = await confirm(tr("Supprimer cet élément de la bibliothèque ?"), {
      title: tr("Supprimer"),
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await deleteFn({ data: { id: item.id } });
      setItems((prev) => (prev ? prev.filter((it) => it.id !== item.id) : prev));
    } catch (e: any) {
      toast.error(e?.message ?? tr("Erreur"));
    }
  };

  return (
    <div className="space-y-2 rounded-lg border p-4">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <History className="h-4 w-4" />
        {tr("Bibliothèque")}
      </p>
      {items === null ? (
        <p className="text-xs text-muted-foreground">{tr("Chargement…")}</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {tr("Aucun fichier enregistré pour cette étape.")}
        </p>
      ) : (
        <ul className="divide-y">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{item.label}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString()}
                  {item.item_count != null ? ` · ${item.item_count} ${tr("question(s)")}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === item.id}
                  onClick={() => show(item)}
                >
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  {tr("Afficher")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busyId === item.id}
                  onClick={() => download(item)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  {tr("Télécharger")}
                </Button>
                {onContinue && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === item.id}
                    onClick={() => doContinue(item)}
                  >
                    {busyId === item.id ? (
                      <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowRight className="mr-1 h-3.5 w-3.5" />
                    )}
                    {tr("Continuer")}
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => rename(item)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => remove(item)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={!!preview} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{preview?.label}</DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap text-sm">{preview?.text}</pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
