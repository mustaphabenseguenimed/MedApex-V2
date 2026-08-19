import { createFileRoute } from "@tanstack/react-router";
import { LandingPage } from "@/components/marketing/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Med Apex — QCM, cas cliniques et résumés pour l'externat" },
      {
        name: "description",
        content:
          "Med Apex regroupe des QCM, des cas cliniques et des résumés de cours pour l'externat, le rattrapage et le résidanat, avec des explications détaillées en français.",
      },
    ],
  }),
  component: LandingPage,
});
