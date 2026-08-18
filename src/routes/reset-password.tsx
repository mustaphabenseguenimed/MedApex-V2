import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast, Toaster } from "sonner";
import { useTr } from "@/lib/i18n";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Med Apex — Réinitialiser le mot de passe" },
      { name: "description", content: "Choisissez un nouveau mot de passe pour votre compte Med Apex." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const tr = useTr();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase places recovery tokens in the URL hash and signs the user in
    // as a "recovery" session. Wait for that session to be established.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error(tr("Mot de passe: 6 caractères minimum")); return; }
    if (password !== confirm) { toast.error(tr("Les mots de passe ne correspondent pas")); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    toast.success(tr("Mot de passe mis à jour"));
    await supabase.auth.signOut();
    navigate({ to: "/", replace: true });
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster richColors position="top-center" />
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gradient">Med Apex</h1>
          <p className="mt-3 text-sm text-muted-foreground">{tr("Choisissez un nouveau mot de passe")}</p>
        </div>
        <Card className="surface-card border-0 shadow-none">
          <CardContent className="pt-6">
            {!ready ? (
              <p className="text-sm text-muted-foreground">
                {tr("Ouvrez le lien reçu par email pour continuer.")}
              </p>
            ) : (
              <form onSubmit={onSubmit} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-pw">{tr("Nouveau mot de passe")}</Label>
                  <PasswordInput id="rp-pw" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-pw2">{tr("Confirmer")}</Label>
                  <PasswordInput id="rp-pw2" required minLength={6} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? tr("Mise à jour...") : tr("Mettre à jour")}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}