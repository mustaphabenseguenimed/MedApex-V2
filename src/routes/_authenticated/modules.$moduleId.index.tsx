import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, BookOpen, ListChecks, Sparkles, Stethoscope, Lock } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { useModuleScope, useModuleColor, moduleBackgroundStyle } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/")({
  component: ModuleHome,
});

type Module = { id: string; title: string; description: string | null; year: number };

function ModuleHome() {
  const { t, tr } = useI18n();
  const { moduleId } = Route.useParams();
  const [mod, setMod] = useState<Module | null>(null);
  const lessons = useModuleScope(moduleId, "lessons");
  const sessions = useModuleScope(moduleId, "sessions");
  const moduleColor = useModuleColor();

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("modules")
        .select("id,title,description,year")
        .eq("id", moduleId)
        .maybeSingle();
      setMod(data as Module | null);
    })();
  }, [moduleId]);

  return (
    <div className="min-h-screen" style={moduleBackgroundStyle(moduleColor)}>
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/dashboard">
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("modules_link")}
            </Link>
          </Button>
          {mod && (
            <Badge variant="secondary">
              {t("year")} {mod.year}
            </Badge>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">{mod?.title ?? "…"}</h1>
          {mod?.description && <p className="mt-2 text-muted-foreground">{mod.description}</p>}
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Link to="/modules/$moduleId/cours" params={{ moduleId }}>
            <Card className="h-full transition hover:shadow-md hover:border-primary/40">
              <CardHeader className="flex-row items-center gap-4 space-y-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <BookOpen className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <CardTitle>{t("course")}</CardTitle>
                  {lessons === "locked" && (
                    <Badge variant="outline" className="mt-1">
                      <Lock className="h-3 w-3 mr-1" />
                      {tr("Verrouillé")}
                    </Badge>
                  )}
                  <CardDescription className="mt-1">{t("course_desc")}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t("course_extra")}
              </CardContent>
            </Card>
          </Link>

          <Link to="/modules/$moduleId/entrainement" params={{ moduleId }}>
            <Card className="h-full border-primary/40 bg-accent/30 transition hover:shadow-md">
              <CardHeader className="flex-row items-center gap-4 space-y-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ListChecks className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <CardTitle className="flex items-center gap-2">
                    {t("practice")}
                    <Sparkles className="h-4 w-4 text-primary" />
                  </CardTitle>
                  {sessions === "locked" && (
                    <Badge variant="outline" className="mt-1">
                      <Lock className="h-3 w-3 mr-1" />
                      {tr("Verrouillé")}
                    </Badge>
                  )}
                  <CardDescription className="mt-1">{t("practice_desc")}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t("practice_extra")}
              </CardContent>
            </Card>
          </Link>

          <Link to="/modules/$moduleId/cas-cliniques" params={{ moduleId }}>
            <Card className="h-full transition hover:shadow-md hover:border-primary/40">
              <CardHeader className="flex-row items-center gap-4 space-y-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <div className="flex-1">
                  <CardTitle>{t("clinical_cases")}</CardTitle>
                  {sessions === "locked" && (
                    <Badge variant="outline" className="mt-1">
                      <Lock className="h-3 w-3 mr-1" />
                      {tr("Verrouillé")}
                    </Badge>
                  )}
                  <CardDescription className="mt-1">{t("clinical_cases_desc")}</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {t("clinical_cases_extra")}
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
