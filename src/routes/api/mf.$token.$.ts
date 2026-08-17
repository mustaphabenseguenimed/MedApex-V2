import { createFileRoute } from "@tanstack/react-router";
import { createServerOnlyFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  contentTypeFor,
  safeJoin,
  verifyModuleFileToken,
} from "@/lib/moduleFile.server";

type MfParams = { token: string; _splat?: string };

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

  const { data, error } = await admin.storage
    .from("module-files")
    .download(objectPath);
  if (error || !data) return new Response("Not found", { status: 404 });

  const buf = await data.arrayBuffer();
  const ct = contentTypeFor(objectPath);
  const isHtml = ct.startsWith("text/html");
  return new Response(buf, {
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