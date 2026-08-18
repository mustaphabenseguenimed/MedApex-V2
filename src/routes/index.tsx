import { createFileRoute } from "@tanstack/react-router";
import { LoginPage } from "@/components/auth/LoginPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Med Apex — Connexion" },
      { name: "description", content: "Connectez-vous à Med Apex, the ultimate medical source." },
    ],
  }),
  component: LoginPage,
});
