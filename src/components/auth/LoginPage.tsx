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
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import { getSiteUrl } from "@/lib/site-url";

export function LoginPage() {
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
      <div className="absolute right-4 top-4 z-10">
        <LanguageSwitcher />
      </div>
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <Eyebrow />
          <h1 className="flex items-center justify-center text-5xl font-bold tracking-tight text-gradient">
            Med{" "}
            <img
              src="/logo-mark.svg"
              alt="A"
              className="h-[1.3em] w-[1.3em] translate-y-[0.08em]"
            />
            pex
          </h1>
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
  const { t, tr } = useI18n();
  return (
    <Card className="surface-card border-0 shadow-none">
      <CardContent className="pt-6">
        <GoogleButton />
        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">{tr("ou")}</span>
          <div className="h-px flex-1 bg-border" />
        </div>
        <Tabs defaultValue="signin">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="signin">{t("tab_signin")}</TabsTrigger>
            <TabsTrigger value="signup">{t("tab_signup")}</TabsTrigger>
          </TabsList>
          <TabsContent value="signin">
            <SignInForm />
          </TabsContent>
          <TabsContent value="signup">
            <SignUpForm />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function GoogleButton() {
  const { tr } = useI18n();
  const [loading, setLoading] = useState(false);
  const onClick = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: getSiteUrl() },
    });
    if (error) {
      setLoading(false);
      toast.error(error.message);
    }
  };
  return (
    <Button type="button" variant="outline" className="w-full" onClick={onClick} disabled={loading}>
      <svg viewBox="0 0 48 48" className="mr-2 h-4 w-4" aria-hidden="true">
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
        />
        <path
          fill="#FF3D00"
          d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.5 6 29.5 4 24 4c-7.6 0-14.1 4.3-17.7 10.7z"
        />
        <path
          fill="#4CAF50"
          d="M24 44c5.4 0 10.3-1.9 14-5.3l-6.5-5.4c-2 1.5-4.7 2.4-7.5 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.8 39.7 16.4 44 24 44z"
        />
        <path
          fill="#1976D2"
          d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.3-4.1 5.7l6.5 5.4C40.5 36.5 44 30.9 44 24c0-1.3-.1-2.7-.4-3.5z"
        />
      </svg>
      {loading ? tr("Redirection...") : tr("Continuer avec Google")}
    </Button>
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
    if (!email) {
      toast.error(tr("Entrez votre email d'abord"));
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/reset-password`,
    });
    setLoading(false);
    if (error) toast.error(error.message);
    else toast.success(tr("Email de réinitialisation envoyé"));
  };
  return (
    <form onSubmit={onSubmit} className="space-y-3 pt-4">
      <div className="space-y-1.5">
        <Label htmlFor="si-email">{t("email")}</Label>
        <Input
          id="si-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="si-pw">{t("password")}</Label>
        <PasswordInput
          id="si-pw"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("signing_in") : t("sign_in")}
      </Button>
      <div className="text-right">
        <button
          type="button"
          onClick={onForgot}
          disabled={loading}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {tr("Mot de passe oublié ?")}
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
    if (password.length < 6) {
      toast.error(tr("Mot de passe: 6 caractères minimum"));
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: getSiteUrl(),
        data: { display_name: name },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
        <Input
          id="su-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="su-pw">{t("password")}</Label>
        <PasswordInput
          id="su-pw"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? t("creating") : t("create_account")}
      </Button>
    </form>
  );
}
