import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { useI18n } from "@/lib/i18n";
import { owns, type Entitlement } from "@/lib/scopes";

export function FreeYear4Popup({ onClaimed }: { onClaimed: () => void }) {
  const { t, tr } = useI18n();
  const [open, setOpen] = useState(false);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: p }, { data: u }] = await Promise.all([
        supabase.from("year_prices").select("*").eq("year", 4).maybeSingle(),
        supabase.auth.getUser(),
      ]);
      const yearPrice = p as unknown as { free: boolean } | null;
      if (!yearPrice?.free || !u.user) return;
      const { data: ents } = await supabase
        .from("user_entitlements")
        .select("year, is_bundle, scope")
        .eq("user_id", u.user.id);
      if (owns((ents as Entitlement[]) ?? [], false, 4, "both")) return;
      setOpen(true);
    })();
  }, []);

  const claim = async () => {
    setClaiming(true);
    try {
      const { error } = await (supabase as any).rpc("claim_free_offer", {
        _is_bundle: false,
        _year: 4,
        _scope: "both",
      });
      if (error) throw error;
      toast.success(t("free_offer_claimed"));
      setOpen(false);
      onClaimed();
    } catch (e: any) {
      toast.error(e.message ?? t("error"));
    } finally {
      setClaiming(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Votre 4ᵉ année est offerte 🎉")}</DialogTitle>
          <DialogDescription>
            {tr(
              "Pour vous remercier de votre confiance, l'accès complet à la 4ᵉ année (cours et sessions) vous est offert gratuitement, sans engagement.",
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={claiming}>
            {tr("Plus tard")}
          </Button>
          <Button onClick={claim} disabled={claiming}>
            {claiming ? tr("Un instant…") : tr("Réclamer mon accès gratuit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
