import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile — Med Apex" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { t, tr } = useI18n();
  const [displayName, setDisplayName] = useState("");
  const [year, setYear] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPw, setChangingPw] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data } = await supabase.from("profiles").select("display_name, current_year").eq("id", u.user.id).maybeSingle();
      setDisplayName(data?.display_name ?? "");
      setYear(data?.current_year ? String(data.current_year) : "");
    })();
  }, []);

  const save = async () => {
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { error } = await supabase.from("profiles").update({
      display_name: displayName || null,
      current_year: year ? Number(year) : null,
    }).eq("id", u.user.id);
    setSaving(false);
    if (error) toast.error(error.message); else toast.success(t("profile_saved"));
  };

  const changePassword = async () => {
    if (newPassword.length < 6) { toast.error(tr("Mot de passe: 6 caractères minimum")); return; }
    if (newPassword !== confirmPassword) { toast.error(tr("Les mots de passe ne correspondent pas")); return; }
    setChangingPw(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPw(false);
    if (error) { toast.error(error.message); return; }
    setNewPassword(""); setConfirmPassword("");
    toast.success(tr("Mot de passe mis à jour"));
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b"><div className="mx-auto max-w-3xl px-6 py-4">
        <Button asChild variant="ghost" size="sm"><Link to="/dashboard"><ArrowLeft className="mr-1.5 h-4 w-4" />{t("back")}</Link></Button>
      </div></header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Card>
          <CardHeader><CardTitle>{t("my_profile")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("display_name")}</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} />
            </div>
            <div className="space-y-2">
              <Label>{t("year_of_study")}</Label>
              <Select value={year} onValueChange={setYear}>
                <SelectTrigger><SelectValue placeholder={t("choose_year")} /></SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5, 6].map((y) => (<SelectItem key={y} value={String(y)}>{t("year")} {y}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={save} disabled={saving}>{saving ? t("saving") : t("save")}</Button>
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader><CardTitle>{tr("Changer le mot de passe")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-pw">{tr("Nouveau mot de passe")}</Label>
              <PasswordInput id="new-pw" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">{tr("Confirmer le mot de passe")}</Label>
              <PasswordInput id="confirm-pw" minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <Button onClick={changePassword} disabled={changingPw || !newPassword || !confirmPassword}>
              {changingPw ? tr("Mise à jour...") : tr("Mettre à jour le mot de passe")}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
