import sanitizeHtml from "sanitize-html";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";
import { applyVraiFauxColors, stripImportedColors } from "@/lib/htmlColors";

const ALLOWED_TAGS = [
  "p","br","hr","strong","em","u","s","ul","ol","li","span","mark","img","a","blockquote","code","pre","h1","h2","h3","h4",
  "table","thead","tbody","tfoot","tr","th","td","caption","colgroup","col"
];
const ALLOWED_ATTRS: sanitizeHtml.IOptions["allowedAttributes"] = {
  span: ["style", "data-vf"],
  mark: ["style","data-color"],
  p: ["style"],
  li: ["style"],
  strong: ["style"],
  em: ["style"],
  u: ["style"],
  a: ["href","target","rel"],
  img: ["src","alt","title","width","height"],
  table: ["class","style"],
  th: ["colspan","rowspan","scope","style"],
  td: ["colspan","rowspan","style"],
  col: ["span","style"],
  "*": ["class"],
};

export function sanitizeExplanationHtml(html: string): string {
  const clean = sanitizeHtml(html ?? "", {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedStyles: {
      "*": {
        color: [/^.*$/],
        "background-color": [/^.*$/],
        background: [/^.*$/],
        "font-weight": [/^.*$/],
        "font-style": [/^.*$/],
        "text-decoration": [/^.*$/],
      },
      table: { width: [/^.*$/], "border-collapse": [/^.*$/] },
      th: { "background-color": [/^.*$/], color: [/^.*$/], "text-align": [/^.*$/], width: [/^.*$/] },
      td: { "background-color": [/^.*$/], color: [/^.*$/], "text-align": [/^.*$/], width: [/^.*$/] },
      col: { width: [/^.*$/] },
    },
    allowedSchemes: ["http", "https", "data", "storage"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
    },
  });
  // Keep author-chosen colors as-is; only clean up mso-* noise.
  return stripImportedColors(clean);
}

/** Resolve `storage://bucket/path` refs to signed URLs. */
async function resolveStorageUrls(html: string): Promise<string> {
  const re = /storage:\/\/([^/\s"']+)\/([^\s"'<>]+)/g;
  const matches = Array.from(html.matchAll(re));
  if (matches.length === 0) return html;
  const cache = new Map<string, string>();
  for (const m of matches) {
    const key = `${m[1]}::${m[2]}`;
    if (cache.has(key)) continue;
    const { data } = await supabase.storage.from(m[1]).createSignedUrl(m[2], 60 * 60);
    cache.set(key, data?.signedUrl ?? "");
  }
  return html.replace(re, (_full, bucket, path) => cache.get(`${bucket}::${path}`) || "");
}

export function RichText({
  html,
  className,
  /** Auto-color "vrai"/"faux" and option letters (A–E). Explanations only. */
  autoColor = false,
}: { html: string | null | undefined; className?: string; autoColor?: boolean }) {
  const [resolved, setResolved] = useState<string>("");
  useEffect(() => {
    let cancel = false;
    const raw = (html ?? "").trim();
    if (!raw) { setResolved(""); return; }
    // Legacy plain text: no tags → wrap for whitespace preservation.
    const looksHtml = /<[a-z][^>]*>/i.test(raw);
    const escaped = raw.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const cleaned = looksHtml ? sanitizeExplanationHtml(raw) : `<p style="white-space:pre-wrap">${escaped}</p>`;
    // Auto-color at render time so the safety net still works without
    // polluting stored/edited HTML. Never applied to question stems/choices.
    const withVF = autoColor ? applyVraiFauxColors(cleaned) : cleaned;
    resolveStorageUrls(withVF).then((r) => { if (!cancel) setResolved(r); });
    return () => { cancel = true; };
  }, [html, autoColor]);
  if (!resolved) return null;
  const base = "[&_hr]:my-3 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border";
  return <div className={[base, className].filter(Boolean).join(" ")} dangerouslySetInnerHTML={{ __html: resolved }} />;
}