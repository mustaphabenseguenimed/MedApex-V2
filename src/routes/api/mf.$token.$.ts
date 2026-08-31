import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { contentTypeFor, safeJoin, verifyModuleFileToken } from "@/lib/moduleFile.server";

type MfParams = { token: string; _splat?: string };

// Same deterrent as src/components/ContentProtection.tsx, but self-contained:
// this HTML is rendered inside a sandboxed iframe with no allow-same-origin,
// so the parent page's JS/CSS can never reach in — the only way to protect
// this content is to inject the guard directly into the served bytes.
// allow-scripts is already granted, so the script runs fine inside the
// iframe's own (opaque-origin) document.
const CONTENT_PROTECTION_SNIPPET = `
<style>
  html, body { -webkit-user-select: none; user-select: none; }
  input, textarea, [contenteditable="true"] { -webkit-user-select: text; user-select: text; }
</style>
<script>
(function () {
  function allowed(t) {
    return t instanceof Element && !!t.closest('input, textarea, [contenteditable="true"]');
  }
  document.addEventListener("contextmenu", function (e) { if (!allowed(e.target)) e.preventDefault(); });
  document.addEventListener("copy", function (e) { if (!allowed(e.target)) e.preventDefault(); });
  document.addEventListener("cut", function (e) { if (!allowed(e.target)) e.preventDefault(); });
  document.addEventListener("dragstart", function (e) {
    if (e.target instanceof HTMLImageElement && !allowed(e.target)) e.preventDefault();
  });
  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "s" || e.key === "S" || e.key === "p" || e.key === "P")) e.preventDefault();
  });
})();
</script>`;

function injectContentProtection(html: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${CONTENT_PROTECTION_SNIPPET}</body>`)
    : html + CONTENT_PROTECTION_SNIPPET;
}

// createServerOnlyFn marks this closure as server-only. TanStack Start's
// import-protection plugin recognizes this boundary and allows the
// .server.ts import inside it, even though this route file is technically
// reachable through routeTree.gen.ts on the client. If this ever executed
// client-side (it won't, since GET handlers only run server-side), it would
// throw instead of silently shipping secrets to the browser.
const handler = createServerOnlyFn(async ({ params }: { params: MfParams }) => {
  const payload = await verifyModuleFileToken(params.token);
  if (!payload) return new Response("Forbidden", { status: 403 });

  const rel = params._splat || payload.entry;
  const objectPath = safeJoin(payload.prefix, rel);
  if (!objectPath) return new Response("Bad path", { status: 400 });

  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  const { data, error } = await admin.storage.from("module-files").download(objectPath);
  if (error || !data) return new Response("Not found", { status: 404 });

  const buf = await data.arrayBuffer();
  const ct = contentTypeFor(objectPath);
  const isHtml = ct.startsWith("text/html");
  const body: BodyInit = isHtml
    ? injectContentProtection(new TextDecoder("utf-8").decode(buf))
    : buf;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      // Untrusted admin-uploaded lesson HTML: force a unique opaque origin
      // so embedded scripts can never touch the app's cookies/storage,
      // even if opened directly instead of through the sandboxed iframe.
      ...(isHtml
        ? { "Content-Security-Policy": "sandbox allow-scripts allow-popups allow-forms" }
        : {}),
    },
  });
});

export const Route = createFileRoute("/api/mf/$token/$")({
  server: { handlers: { GET: handler } },
} as any);
