import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Lock, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { ModuleColorProvider } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId")({
  component: ModuleGate,
});

function ModuleGate() {
  const { t } = useI18n();
  const { moduleId } = Route.useParams();
  const [status, setStatus] = useState<"loading" | "ok" | "locked" | "missing">("loading");
  const [year, setYear] = useState<number | null>(null);
  const [color, setColor] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        setStatus("locked");
        return;
      }
      const { data: mod } = await supabase
        .from("modules")
        .select("year,color")
        .eq("id", moduleId)
        .maybeSingle();
      if (!mod) {
        setStatus("missing");
        return;
      }
      setYear(mod.year);
      setColor(mod.color ?? null);
      const { data: ok } = await supabase.rpc("user_has_year_access", {
        _user_id: u.user.id,
        _year: mod.year,
      });
      setStatus(ok ? "ok" : "locked");
    })();
  }, [moduleId]);

  if (status === "loading") return <div className="p-10 text-center text-muted-foreground">…</div>;
  if (status === "missing")
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardContent className="py-10 text-center space-y-4">
            <p className="text-muted-foreground">{t("module_not_found")}</p>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {t("dashboard")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  if (status === "locked")
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md w-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              {t("content_locked")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("must_purchase_year").replace("{year}", String(year ?? ""))}
            </p>
            <div className="flex gap-2">
              <Button asChild>
                <Link to="/store">{t("view_store")}</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/dashboard">
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  {t("dashboard")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  return (
    <ModuleColorProvider value={color}>
      <Outlet />
    </ModuleColorProvider>
  );
}
