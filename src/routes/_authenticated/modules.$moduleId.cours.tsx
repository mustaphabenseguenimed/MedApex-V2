import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, FileType, BookOpen, Dumbbell, Link as LinkIcon } from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { ModuleScopeGate, useModuleColor, moduleBackgroundStyle } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/cours")({
  component: CoursGate,
});

function CoursGate() {
  const { moduleId } = Route.useParams();
  return (
    <ModuleScopeGate moduleId={moduleId} scope="lessons">
      <CoursPage />
    </ModuleScopeGate>
  );
}

type Content = {
  id: string;
  kind: "html" | "pdf" | "richtext" | "link";
  title: string;
  description: string | null;
};
type Module = { id: string; title: string; description: string | null; year: number };

const kindMeta: Record<Content["kind"], { label: TKey; icon: typeof BookOpen }> = {
  html: { label: "html_sheet", icon: BookOpen },
  pdf: { label: "pdf", icon: FileType },
  richtext: { label: "notes", icon: FileText },
  link: { label: "link_resource", icon: LinkIcon },
};

function CoursPage() {
  const { t } = useI18n();
  const { moduleId } = Route.useParams();
  const [mod, setMod] = useState<Module | null>(null);
  const [items, setItems] = useState<Content[]>([]);
  const moduleColor = useModuleColor();

  useEffect(() => {
    (async () => {
      const { data: m } = await supabase
        .from("modules")
        .select("id,title,description,year")
        .eq("id", moduleId)
        .maybeSingle();
      setMod(m as Module | null);
      const { data: c } = await supabase
        .from("module_contents")
        .select("id,kind,title,description")
        .eq("module_id", moduleId)
        .in("kind", ["html", "pdf", "richtext", "link"])
        .order("sort_order")
        .order("created_at");
      setItems((c as Content[]) ?? []);
    })();
  }, [moduleId]);

  return (
    <div className="min-h-screen" style={moduleBackgroundStyle(moduleColor)}>
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
          <Button asChild variant="ghost" size="sm">
            <Link to="/modules/$moduleId" params={{ moduleId }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("back_to_module")}
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
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {mod?.title ?? "…"} · {t("course")}
            </h1>
            {mod?.description && <p className="mt-2 text-muted-foreground">{mod.description}</p>}
          </div>
          <Button asChild size="lg" className="shrink-0">
            <Link to="/modules/$moduleId/entrainement" params={{ moduleId }}>
              <Dumbbell className="mr-1.5 h-4 w-4" />
              {t("practice_this_module")}
            </Link>
          </Button>
        </div>

        {items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("no_course")}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-10">
            {(["html", "pdf", "richtext", "link"] as const).map((kind) => {
              const group = items.filter((c) => c.kind === kind);
              if (group.length === 0) return null;
              const meta = kindMeta[kind];
              const Icon = meta.icon;
              return (
                <section key={kind}>
                  <div className="mb-3 flex items-center gap-2">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{t(meta.label)}</h2>
                    <Badge variant="secondary" className="ml-1">
                      {group.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {group.map((content) => (
                      <Link
                        key={content.id}
                        to="/modules/$moduleId/$contentId"
                        params={{ moduleId, contentId: content.id }}
                      >
                        <Card className="transition hover:shadow-md">
                          <CardHeader className="flex-row items-center gap-4 space-y-0">
                            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div className="flex-1">
                              <CardTitle className="text-base">{content.title}</CardTitle>
                              {content.description && (
                                <CardDescription className="mt-1">
                                  {content.description}
                                </CardDescription>
                              )}
                            </div>
                            <Badge variant="outline">{t(meta.label)}</Badge>
                          </CardHeader>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
