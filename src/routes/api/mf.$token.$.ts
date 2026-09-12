import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { contentTypeFor, safeJoin, verifyModuleFileToken } from "@/lib/moduleFile.server";

type MfParams = { token: string; _splat?: string };

// The iframe is sandboxed WITHOUT allow-same-origin (deliberately — see the
// note on the iframe itself), which puts the document on an opaque origin.
// There, merely *reading* localStorage, sessionStorage or document.cookie
// throws a SecurityError rather than returning empty.
//
// That breaks lesson HTML that does nothing wrong: a résumé whose script
// starts by restoring saved preferences dies on that first read, and every
// control it was about to wire up — width slider, collapsible sommaire —
// silently never works, while the same file behaves perfectly when opened
// directly. Give the document its own in-memory storage so the read
// succeeds. It stays fully walled off from the app's real storage (still an
// opaque origin, nothing shared, nothing persisted across reloads); the
// point is only that touching these APIs must not throw.
//
// Must run BEFORE the document's own scripts, so it is injected at the top
// of <head> rather than before </body> like the snippets below.
const STORAGE_SHIM_SNIPPET = `<script>
(function () {
  function memoryStorage() {
    var data = Object.create(null);
    return {
      getItem: function (k) {
        k = String(k);
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null;
      },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { var ks = Object.keys(data); return i < ks.length ? ks[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  function shim(name) {
    try {
      window[name].getItem("probe");
      return; // real storage works (file opened directly) — leave it alone
    } catch (e) {}
    try {
      Object.defineProperty(window, name, { value: memoryStorage(), configurable: true });
    } catch (e) {}
  }
  shim("localStorage");
  shim("sessionStorage");
  try {
    void document.cookie;
  } catch (e) {
    try {
      var jar = "";
      Object.defineProperty(Document.prototype, "cookie", {
        configurable: true,
        get: function () { return jar; },
        set: function (v) { jar = String(v); }
      });
    } catch (e2) {}
  }
})();
</script>`;

/** Inject as early as possible: the document's own scripts must see the shim
 *  already in place. */
function injectStorageShim(html: string): string {
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + STORAGE_SHIM_SNIPPET);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + STORAGE_SHIM_SNIPPET);
  }
  return STORAGE_SHIM_SNIPPET + html;
}

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

// A brand watermark, not a per-viewer trace: tile "Med Apex" across the
// page, semi-transparent. Base64 data URI (not a raw `url("...")`) keeps
// this safe even if the label ever changes to include untrusted text again.
const WATERMARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="180"><text x="20" y="110" transform="rotate(-30 180 90)" font-family="sans-serif" font-size="15" fill="rgba(120,120,120,0.35)">Med Apex</text></svg>';
const WATERMARK_SNIPPET = `<div aria-hidden="true" style="position:fixed;inset:0;pointer-events:none;z-index:2147483647;background-image:url('data:image/svg+xml;base64,${Buffer.from(WATERMARK_SVG, "utf-8").toString("base64")}');background-repeat:repeat;"></div>`;

function injectWatermark(html: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${WATERMARK_SNIPPET}</body>`)
    : html + WATERMARK_SNIPPET;
}

// Not every résumé ships its own collapsible sommaire, and the app can't add
// one from outside: the same missing allow-same-origin that protects us also
// means the parent page cannot touch this DOM. So the button is injected
// here, inside the document, where it can actually find the table of
// contents.
//
// Deliberately timid. It only appears when a table of contents is identified
// with reasonable confidence, and it stands down entirely when the document
// already has a control of its own — a résumé that brought its own toggle
// must not end up with two. When nothing is found, nothing is added.
const SOMMAIRE_TOGGLE_SNIPPET = `<script>
(function () {
  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  function findToc() {
    var direct = document.querySelector(
      "#toc, #sommaire, #table-of-contents, .toc, .sommaire, [data-toc], nav.toc, nav#sommaire"
    );
    if (direct) return direct;
    var landmarks = document.querySelectorAll("nav, aside");
    for (var i = 0; i < landmarks.length; i++) {
      if (landmarks[i].querySelectorAll('a[href^="#"]').length >= 3) return landmarks[i];
    }
    // Last resort: a link-dense block that isn't prose.
    var best = null, bestCount = 4;
    var blocks = document.querySelectorAll("div, ul, ol, section");
    for (var j = 0; j < blocks.length; j++) {
      var links = blocks[j].querySelectorAll('a[href^="#"]').length;
      if (links > bestCount && blocks[j].querySelectorAll("p").length <= 2) {
        best = blocks[j];
        bestCount = links;
      }
    }
    return best;
  }
  function hasOwnToggle() {
    var controls = document.querySelectorAll("button, a, [role=button], input[type=checkbox]");
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      var hay = [c.textContent || "", c.getAttribute("aria-label") || "", c.id || "",
                 typeof c.className === "string" ? c.className : ""].join(" ");
      if (/sommaire|table des mati|replier|masquer|toggle-toc|toc-toggle/i.test(hay)) return true;
    }
    return false;
  }
  ready(function () {
    if (hasOwnToggle()) return;
    var toc = findToc();
    if (!toc) return;
    var hidden = false;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Masquer le sommaire";
    btn.setAttribute("aria-expanded", "true");
    btn.style.cssText = [
      "position:fixed", "bottom:12px", "right:12px", "z-index:2147483646",
      "font:500 13px/1.2 system-ui,sans-serif", "padding:8px 12px", "border-radius:999px",
      "border:1px solid rgba(120,120,120,0.35)", "background:#fff", "color:#111",
      "box-shadow:0 2px 8px rgba(0,0,0,0.18)", "cursor:pointer"
    ].join(";");
    btn.addEventListener("click", function () {
      hidden = !hidden;
      toc.style.display = hidden ? "none" : "";
      btn.textContent = hidden ? "Afficher le sommaire" : "Masquer le sommaire";
      btn.setAttribute("aria-expanded", hidden ? "false" : "true");
    });
    document.body.appendChild(btn);
  });
})();
</script>`;

function injectSommaireToggle(html: string): string {
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${SOMMAIRE_TOGGLE_SNIPPET}</body>`)
    : html + SOMMAIRE_TOGGLE_SNIPPET;
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
    ? injectWatermark(
        injectSommaireToggle(
          injectContentProtection(injectStorageShim(new TextDecoder("utf-8").decode(buf))),
        ),
      )
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
