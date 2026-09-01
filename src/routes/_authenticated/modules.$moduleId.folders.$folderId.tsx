import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  FileText,
  FileType,
  ListChecks,
  BookOpen,
  Link as LinkIcon,
} from "lucide-react";
import { useI18n, type TKey } from "@/lib/i18n";
import { ModuleScopeGate, useModuleColor, moduleBackgroundStyle } from "@/lib/scopes";

export const Route = createFileRoute("/_authenticated/modules/$moduleId/folders/$folderId")({
  component: FolderGate,
});

function FolderGate() {
  const { moduleId } = Route.useParams();
  return (
    <ModuleScopeGate moduleId={moduleId} scope="lessons">
      <FolderView />
    </ModuleScopeGate>
  );
}

type Kind = "html" | "pdf" | "richtext" | "quiz" | "link";
type Content = {
  id: string;
  kind: Kind;
  title: string;
  description: string | null;
  folder_id: string | null;
};

const KIND_META: Record<Kind, { label: TKey; icon: typeof BookOpen }> = {
  html: { label: "html_sheet", icon: BookOpen },
  pdf: { label: "pdf", icon: FileType },
  richtext: { label: "notes", icon: FileText },
  quiz: { label: "qcm", icon: ListChecks },
  link: { label: "link_resource", icon: LinkIcon },
};

function FolderView() {
  const { t } = useI18n();
  const { moduleId, folderId } = Route.useParams();
  const isUnfiled = folderId === "__none";
  const [name, setName] = useState<string>(isUnfiled ? t("unfiled") : "…");
  const [items, setItems] = useState<Content[]>([]);
  const moduleColor = useModuleColor();

  useEffect(() => {
    (async () => {
      if (!isUnfiled) {
        const { data } = await supabase
          .from("module_folders")
          .select("name")
          .eq("id", folderId)
          .maybeSingle();
        if (data) setName(data.name);
      }
      let q = supabase
        .from("module_contents")
        .select("id,kind,title,description,folder_id")
        .eq("module_id", moduleId)
        .order("sort_order")
        .order("created_at");
      q = isUnfiled ? q.is("folder_id", null) : q.eq("folder_id", folderId);
      const { data: c } = await q;
      setItems((c as Content[]) ?? []);
    })();
  }, [moduleId, folderId, isUnfiled]);

  return (
    <div className="min-h-screen" style={moduleBackgroundStyle(moduleColor)}>
      <header className="border-b">
        <div className="mx-auto max-w-5xl px-6 py-4">
          <Button asChild variant="ghost" size="sm">
            <Link to="/modules/$moduleId/cours" params={{ moduleId }}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {t("back_to_courses")}
            </Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-semibold tracking-tight mb-6">{name}</h1>
        {items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              {t("no_content_folder")}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {items.map((content) => {
              const meta = KIND_META[content.kind];
              const Icon = meta.icon;
              return (
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
                          <CardDescription className="mt-1">{content.description}</CardDescription>
                        )}
                      </div>
                      <Badge variant="outline">{t(meta.label)}</Badge>
                    </CardHeader>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
