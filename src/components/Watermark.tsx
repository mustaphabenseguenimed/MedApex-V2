import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fixed, semi-transparent, tiled overlay showing the logged-in student's
 * email, so a leaked screenshot of protected content can be traced back to
 * who took it. Best-effort like the rest of the content-protection layer:
 * it doesn't and can't prevent a screenshot — nothing on the web layer sees
 * the OS compositor — it just changes the incentive to share one.
 */
export function Watermark() {
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getUser().then(({ data }) => {
      if (!cancelled && data.user?.email) setEmail(data.user.email);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!email) return null;

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='340' height='170'><text x='10' y='100' transform='rotate(-30 170 85)' font-family='sans-serif' font-size='14' fill='rgba(120,120,120,0.35)'>${escapeXml(email)}</text></svg>`;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40"
      style={{
        backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`,
        backgroundRepeat: "repeat",
      }}
    />
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
