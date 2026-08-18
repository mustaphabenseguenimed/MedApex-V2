import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Toaster } from "sonner";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Med Apex — Connexion" },
      { name: "description", content: "Connectez-vous à Med Apex, the ultimate medical source." },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        navigate({ to: "/dashboard", replace: true });
      } else {
        setChecking(false);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" && session) navigate({ to: "/dashboard", replace: true });
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  if (checking) {
    return <div className="min-h-screen bg-background" />;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-10">
      <Toaster richColors position="top-center" />
      <div className="absolute left-4 top-4 z-10">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
          ← Accueil
        </Link>
      </div>
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <Eyebrow />
          <h1 className="text-5xl font-bold tracking-tight text-gradient">Med Apex</h1>
          <Tagline />
        </div>
        <AuthCard />
      </div>
    </div>
  );
}

function Eyebrow() {
  const { t } = useI18n();
  return <p className="eyebrow mb-3">{t("eyebrow_prep")}</p>;
}
function Tagline() {
  const { t } = useI18n();
  return <p className="mt-3 text-sm text-muted-foreground">{t("tagline")}</p>;
}

function AuthCard() {
  const { t } = useI18n();
  return (
    <Card className="surface-card border-0 shadow-none">
      <CardContent className="pt-6">
        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">{t("tab_signin")}</TabsTrigger>
            <TabsTrigger value="signup">{t("tab_signup")}</TabsTrigger>
          </TabsList>
          <TabsContent value="signin"><SignInForm /></TabsContent>
          <TabsContent value="signup"><SignUpForm /></TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function SignInForm() {
  const { t, tr } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success(t("sign_in"));
  };
  const onForgot = async () => {
    if (!email) { toast.error(tr("Entrez votre email d'abord")); return; }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success(tr("Email de réinitialisation envoyé"));
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="si-email">{t("email")}</Label>
        <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="si-pw">{t("password")}</Label>
        <PasswordInput id="si-pw" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("signing_in") : t("sign_in")}
      </Button>
      <div className="text-right">
        <button type="button" onClick={onForgot} disabled={loading}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          {tr("Mot de passe oublié\u00a0?")}
        </button>
      </div>
    </form>
  );
}

function SignUpForm() {
  const { t, tr } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) { toast.error(tr("Mot de passe: 6 caractères minimum")); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { display_name: name },
      },
    });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    if (data.session) {
      toast.success(tr("Compte créé — bienvenue !"));
      navigate({ to: "/dashboard", replace: true });
    } else {
      toast.success(tr("Compte créé — vous pouvez vous connecter."));
    }
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="su-name">{t("display_name")}</Label>
        <Input id="su-name" required value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="su-email">{t("email")}</Label>
        <Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="su-pw">{t("password")}</Label>
        <PasswordInput id="su-pw" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("creating") : t("create_account")}
      </Button>
    </form>
  );
}
