import { useEditor, EditorContent } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import { Image } from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, ImagePlus, Palette, RotateCcw, Highlighter, Strikethrough, ScanEye, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sanitizeExplanationHtml, RichText } from "./RichText";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n";

const COLORS = [
  { label: "Rouge", value: "#dc2626" },
  { label: "Vert", value: "#16a34a" },
  { label: "Bleu", value: "#2563eb" },
  { label: "Orange", value: "#ea580c" },
  { label: "Violet", value: "#7c3aed" },
  { label: "Rose", value: "#db2777" },
];

const HIGHLIGHTS = [
  { label: "Jaune", value: "#fef08a" },
  { label: "Vert", value: "#bbf7d0" },
  { label: "Bleu", value: "#bfdbfe" },
  { label: "Rose", value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
];

const SwatchRow = ({ editor }: { editor: any }) => {
  const { tr } = useI18n();
  return (
  <>
    <div className="flex items-center gap-0.5">
      <Palette className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
      {COLORS.map((c) => (
        <button key={c.value} type="button" title={`${tr("Texte")} ${tr(c.label)}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().setColor(c.value).run()}
          className="h-4 w-4 rounded border" style={{ background: c.value }} />
      ))}
      <label title={tr("Couleur personnalisée")}
        className="ml-0.5 inline-flex h-4 w-4 cursor-pointer items-center justify-center overflow-hidden rounded border">
        <input type="color" className="h-6 w-6 cursor-pointer border-0 bg-transparent p-0"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()} />
      </label>
      <button type="button" title={tr("Effacer la couleur")} onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().unsetColor().run()}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent text-muted-foreground"><RotateCcw className="h-3 w-3" /></button>
    </div>
    <div className="mx-1 h-4 w-px bg-border" />
    <div className="flex items-center gap-0.5">
      <Highlighter className="mx-1 h-3.5 w-3.5 text-muted-foreground" />
      {HIGHLIGHTS.map((c) => (
        <button key={c.value} type="button" title={`${tr("Surligner")} ${tr(c.label)}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => editor.chain().focus().toggleHighlight({ color: c.value }).run()}
          className="h-4 w-4 rounded border" style={{ background: c.value }} />
      ))}
      <button type="button" title={tr("Retirer le surlignage")} onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().unsetHighlight().run()}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent text-muted-foreground"><RotateCcw className="h-3 w-3" /></button>
    </div>
  </>
  );
};

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 90,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}) {
  const { tr } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  const [imgChecks, setImgChecks] = useState<{ src: string; ok: boolean | null }[]>([]);
  // Map signed URL → canonical `storage://bucket/path` so we can rewrite the
  // HTML on save. Signed URLs expire (7 days); the storage:// form is
  // re-signed on read by RichText, so persisted HTML stays valid forever.
  const signedToStorageRef = useRef<Map<string, string>>(new Map());
  // Resolve `storage://bucket/path` refs (how images are persisted) into
  // signed URLs so the editor can actually render them while editing.
  const resolveStorageRefs = async (html: string) => {
    const re = /storage:\/\/([^/\s"']+)\/([^\s"'<>]+)/g;
    const matches = Array.from(html.matchAll(re));
    if (!matches.length) return html;
    const cache = new Map<string, string>();
    for (const m of matches) {
      const key = `${m[1]}::${m[2]}`;
      if (cache.has(key)) continue;
      const { data } = await supabase.storage.from(m[1]).createSignedUrl(m[2], 60 * 60);
      const signed = data?.signedUrl ?? "";
      cache.set(key, signed);
      if (signed) signedToStorageRef.current.set(signed, `storage://${m[1]}/${m[2]}`);
    }
    return html.replace(re, (full, bucket, path) => cache.get(`${bucket}::${path}`) || full);
  };
  const rewriteSignedUrls = (html: string) => {
    let out = html;
    for (const [signed, storage] of signedToStorageRef.current) {
      if (!signed) continue;
      out = out.split(signed).join(storage);
    }
    return out;
  };
  // Track the most recent HTML we emitted to the parent. When `value` prop
  // echoes back the same string (after the parent's sanitize/state update),
  // we must NOT call `setContent` — that resets the selection and causes
  // "cursor jumps to next line" / "space needs two clicks" on every keystroke.
  const hasStorageRefs = /storage:\/\//.test(value || "");
  const lastEmittedRef = useRef<string>(hasStorageRefs ? "" : value || "");
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: hasStorageRefs ? "" : value || "",
    onUpdate: ({ editor }) => {
      const html = sanitizeExplanationHtml(rewriteSignedUrls(editor.getHTML()));
      lastEmittedRef.current = html;
      onChange(html);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none px-3 py-2",
        style: `min-height:${minHeight}px`,
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const next = value || "";
    // Skip when the incoming value is what we just emitted — otherwise
    // setContent would rebuild the doc and clobber the cursor mid-typing.
    if (next === lastEmittedRef.current) return;
    const current = editor.getHTML();
    if (next === current) return;
    lastEmittedRef.current = next;
    if (!/storage:\/\//.test(next)) {
      editor.commands.setContent(next, { emitUpdate: false });
      return;
    }
    resolveStorageRefs(next).then((resolved) => {
      if (cancelled || !editor) return;
      editor.commands.setContent(resolved, { emitUpdate: false });
    });
    return () => { cancelled = true; };
  }, [value, editor]);

  const uploadImage = async (file: File) => {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("explanation-images").upload(path, file, { upsert: false, contentType: file.type });
    if (error) { toast.error(error.message); return; }
    // Preview with a signed URL for immediacy, but persist the canonical
    // `storage://…` form so the RichText renderer can re-sign on read and
    // the link never expires.
    const storageRef = `storage://explanation-images/${path}`;
    const { data } = await supabase.storage
      .from("explanation-images")
      .createSignedUrl(path, 60 * 60);
    const signed = data?.signedUrl;
    if (signed) signedToStorageRef.current.set(signed, storageRef);
    editor?.chain().focus().setImage({ src: signed || storageRef }).run();
  };

  if (!editor) return <div className="rounded-md border bg-muted/30" style={{ minHeight }} />;

  // Quick "test image preview": takes the HTML exactly as it will be persisted
  // (storage:// refs), re-signs each image the way the reader does, and reports
  // whether every image actually loads.
  const runImageTest = async () => {
    const persisted = sanitizeExplanationHtml(rewriteSignedUrls(editor.getHTML()));
    setPreviewHtml(persisted);
    setPreviewOpen(true);
    const refs = Array.from(persisted.matchAll(/<img[^>]+src="([^"]+)"/g)).map((m) => m[1]);
    if (!refs.length) { setImgChecks([]); return; }
    setImgChecks(refs.map((src) => ({ src, ok: null })));
    const results = await Promise.all(
      refs.map(async (src) => {
        let url = src;
        const m = src.match(/^storage:\/\/([^/]+)\/(.+)$/);
        if (m) {
          const { data } = await supabase.storage.from(m[1]).createSignedUrl(m[2], 60 * 60);
          url = data?.signedUrl ?? "";
        }
        if (!url) return { src, ok: false };
        const ok = await new Promise<boolean>((resolve) => {
          const img = new window.Image();
          img.onload = () => resolve(true);
          img.onerror = () => resolve(false);
          img.src = url;
        });
        return { src, ok };
      })
    );
    setImgChecks(results);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) toast.error(tr("{n} image(s) ne se chargent pas").replace("{n}", String(failed)));
    else toast.success(tr("{n} image(s) OK").replace("{n}", String(results.length)));
  };

  const B = ({ active, onClick, children, title }: any) => (
    <button type="button" onMouseDown={(e: any) => e.preventDefault()} onClick={onClick} title={title}
      className={`inline-flex h-7 w-7 items-center justify-center rounded hover:bg-accent ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}>
      {children}
    </button>
  );

  return (
    <div className="rounded-md border bg-background">
      <BubbleMenu editor={editor} options={{ placement: "top" }}
        className="flex flex-wrap items-center gap-0.5 rounded-md border bg-popover px-1 py-1 shadow-md">
        <B active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title={tr("Gras")}><Bold className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title={tr("Italique")}><Italic className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title={tr("Souligné")}><UnderlineIcon className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title={tr("Barré")}><Strikethrough className="h-3.5 w-3.5" /></B>
        <div className="mx-1 h-4 w-px bg-border" />
        <SwatchRow editor={editor} />
      </BubbleMenu>
      <div className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1">
        <B active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()} title={tr("Gras")}><Bold className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()} title={tr("Italique")}><Italic className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()} title={tr("Souligné")}><UnderlineIcon className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()} title={tr("Barré")}><Strikethrough className="h-3.5 w-3.5" /></B>
        <div className="mx-1 h-4 w-px bg-border" />
        <B active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()} title={tr("Liste")}><List className="h-3.5 w-3.5" /></B>
        <B active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()} title={tr("Liste numérotée")}><ListOrdered className="h-3.5 w-3.5" /></B>
        <div className="mx-1 h-4 w-px bg-border" />
        <SwatchRow editor={editor} />
        <div className="mx-1 h-4 w-px bg-border" />
        <B onClick={() => fileRef.current?.click()} title={tr("Insérer une image")}><ImagePlus className="h-3.5 w-3.5" /></B>
        <B onClick={runImageTest} title={tr("Tester l'aperçu des images")}><ScanEye className="h-3.5 w-3.5" /></B>
        <input ref={fileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }} />
      </div>
      <EditorContent editor={editor} />
      {placeholder && !value && (
        <div className="pointer-events-none -mt-8 px-3 pb-2 text-sm text-muted-foreground">{placeholder}</div>
      )}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{tr("Test d'aperçu des images")}</DialogTitle>
            <DialogDescription>
              {tr("Rendu tel qu'il sera affiché après enregistrement (liens de stockage re-signés).")}
            </DialogDescription>
          </DialogHeader>
          {imgChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr("Aucune image dans ce contenu.")}</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {imgChecks.map((c, i) => (
                <li key={i} className="flex items-center gap-2">
                  {c.ok === null ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    : c.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    : <XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
                  <span className="truncate font-mono">{c.src}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="rounded-md border p-3">
            <RichText html={previewHtml} autoColor className="prose prose-sm dark:prose-invert max-w-none" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}