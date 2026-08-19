import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { LanguageSwitcher, useI18n } from "@/lib/i18n";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  GraduationCap,
  ListChecks,
  Sparkles,
  Stethoscope,
  XCircle,
} from "lucide-react";

export function LandingPage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session));
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader signedIn={signedIn} />
      <Hero signedIn={signedIn} />
      <ValueProps />
      <Examples />
      <ClosingCta signedIn={signedIn} />
      <SiteFooter />
    </div>
  );
}

function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const { tr } = useI18n();
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <span className="flex items-center text-2xl font-bold tracking-tight text-gradient">
          Med{" "}
          <img src="/logo-mark.svg" alt="" className="h-[1.2em] w-[1.2em] translate-y-[0.06em]" />
          pex
        </span>
        <div className="flex items-center gap-2">
          <LanguageSwitcher />
          <Button asChild size="sm">
            <Link to={signedIn ? "/dashboard" : "/login"}>
              {signedIn ? tr("Tableau de bord") : tr("Se connecter")}
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

function Hero({ signedIn }: { signedIn: boolean }) {
  const { tr } = useI18n();
  return (
    <section className="mx-auto max-w-4xl px-6 pb-14 pt-16 text-center sm:pt-24">
      <p className="eyebrow mb-4">{tr("Révision médicale — cursus algérien")}</p>
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        {tr("Toute la médecine, ")}
        <span className="text-gradient">{tr("un seul endroit.")}</span>
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground sm:text-lg">
        {tr(
          "Med Apex regroupe des QCM, des cas cliniques et des résumés de cours pour l'externat (P1–P6), la rattrapage et le résidanat — avec des explications détaillées en français pour chaque réponse.",
        )}
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Button asChild size="lg" className="btn-glow">
          <Link to={signedIn ? "/dashboard" : "/login"}>
            {signedIn ? tr("Continuer") : tr("Commencer gratuitement")}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <a href="#exemples">{tr("Voir des exemples")}</a>
        </Button>
      </div>
    </section>
  );
}

function ValueProps() {
  const { tr } = useI18n();
  const items = [
    {
      icon: ListChecks,
      title: tr("Banques de QCM"),
      body: tr(
        "Des milliers de questions classées par rotation et par spécialité, avec correction détaillée.",
      ),
    },
    {
      icon: Stethoscope,
      title: tr("Cas cliniques"),
      body: tr(
        "Des vignettes cliniques complètes avec sous-questions, pour raisonner comme en examen.",
      ),
    },
    {
      icon: FileText,
      title: tr("Résumés de cours"),
      body: tr(
        "Des fiches structurées et mises en forme, pour réviser l'essentiel avant l'examen.",
      ),
    },
  ];
  return (
    <section className="border-t border-border/60 bg-muted/20 py-14">
      <div className="mx-auto grid max-w-6xl gap-6 px-6 sm:grid-cols-3">
        {items.map(({ icon: Icon, title, body }) => (
          <Card key={title} className="surface-card border-0 shadow-none">
            <CardContent className="pt-6">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="text-base font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground">{body}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-8 text-center">
      <p className="eyebrow mb-2">{eyebrow}</p>
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h2>
    </div>
  );
}

function Examples() {
  const { tr } = useI18n();
  return (
    <section id="exemples" className="mx-auto max-w-5xl px-6 py-16 scroll-mt-20">
      <SectionHeading eyebrow={tr("Aperçu du contenu")} title={tr("Ce que vous allez réviser")} />
      <div className="space-y-10">
        <ExampleQcm />
        <ExampleCasClinique />
        <ExampleResume />
      </div>
    </section>
  );
}

function ExampleLabel({ icon: Icon, label }: { icon: typeof ListChecks; label: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}

function ExampleQcm() {
  const { tr } = useI18n();
  const choices = [
    { text: tr("La dyspnée d'effort"), correct: true },
    { text: tr("Les œdèmes des membres inférieurs"), correct: true },
    { text: tr("L'orthopnée"), correct: true },
    { text: tr("La polyurie"), correct: false },
  ];
  return (
    <div>
      <ExampleLabel icon={ListChecks} label={tr("Exemple de QCM")} />
      <Card className="surface-card border-0 shadow-none">
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tr("Cardiologie")}</Badge>
            <Badge variant="outline">QCM</Badge>
          </div>
          <p className="font-medium">
            {tr(
              "Parmi les propositions suivantes, lesquelles font partie des signes cliniques de l'insuffisance cardiaque gauche ?",
            )}
          </p>
          <div className="mt-4 space-y-2">
            {choices.map((c) => (
              <div
                key={c.text}
                className={`flex items-center gap-2.5 rounded-md border px-3 py-2 text-sm ${
                  c.correct ? "border-emerald-500/40 bg-emerald-500/10" : "border-border"
                }`}
              >
                {c.correct ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span>{c.text}</span>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{tr("Explication : ")}</span>
            {tr(
              "L'insuffisance cardiaque gauche se manifeste par une congestion en amont du ventricule gauche : dyspnée d'effort, orthopnée, et à un stade avancé des œdèmes. La polyurie n'est pas un signe caractéristique.",
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ExampleCasClinique() {
  const { tr } = useI18n();
  return (
    <div>
      <ExampleLabel icon={Stethoscope} label={tr("Exemple de cas clinique")} />
      <Card className="surface-card border-0 shadow-none">
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tr("Pneumologie")}</Badge>
            <Badge variant="outline">{tr("Cas clinique")}</Badge>
          </div>
          <p className="text-sm leading-relaxed">
            {tr(
              "Patient de 58 ans, tabagique à 30 paquets-années, se présente aux urgences pour une dyspnée d'apparition brutale associée à une douleur thoracique droite. À l'examen : tachycardie à 110/min, saturation à 91% en air ambiant.",
            )}
          </p>
          <Accordion type="multiple" defaultValue={["q1"]} className="mt-4">
            <AccordionItem value="q1">
              <AccordionTrigger className="text-sm">
                {tr("1. Quel diagnostic évoquez-vous en priorité ?")}
              </AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  {tr("Embolie pulmonaire")}
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-muted-foreground">
                  {tr(
                    "Le terrain (tabagisme), l'installation brutale et la désaturation orientent en premier lieu vers une embolie pulmonaire.",
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
            <AccordionItem value="q2">
              <AccordionTrigger className="text-sm">
                {tr("2. Quel examen demandez-vous en première intention ?")}
              </AccordionTrigger>
              <AccordionContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  {tr("Angioscanner thoracique")}
                </div>
                <div className="rounded-md bg-muted/50 p-3 text-muted-foreground">
                  {tr(
                    "C'est l'examen de référence pour confirmer le diagnostic d'embolie pulmonaire chez un patient stable.",
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </CardContent>
      </Card>
    </div>
  );
}

function ExampleResume() {
  const { tr } = useI18n();
  return (
    <div>
      <ExampleLabel icon={FileText} label={tr("Exemple de résumé de cours")} />
      <Card className="surface-card border-0 shadow-none">
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{tr("Endocrinologie")}</Badge>
            <Badge variant="outline">{tr("Résumé")}</Badge>
          </div>
          <div className="space-y-3 text-sm leading-relaxed">
            <h3 className="text-base font-semibold">{tr("Diabète de type 2 — points clés")}</h3>
            <p>
              {tr("Le diabète de type 2 associe une ")}
              <strong>{tr("insulinorésistance")}</strong>
              {tr(" et un déficit progressif de l'insulinosécrétion. Il représente ")}
              <mark className="rounded bg-amber-200/60 px-1 dark:bg-amber-400/20">
                {tr("environ 90% des cas de diabète")}
              </mark>
              {tr(".")}
            </p>
            <ul className="ml-4 list-disc space-y-1">
              <li>{tr("Diagnostic : glycémie à jeun ≥ 1,26 g/L à deux reprises")}</li>
              <li>
                {tr("Première ligne thérapeutique : règles hygiéno-diététiques + metformine")}
              </li>
              <li>
                {tr(
                  "Dépistage des complications : fond d'œil, microalbuminurie, bilan cardiovasculaire",
                )}
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ClosingCta({ signedIn }: { signedIn: boolean }) {
  const { tr } = useI18n();
  if (signedIn) return null;
  return (
    <section className="border-t border-border/60 bg-muted/20 py-16">
      <div className="mx-auto max-w-2xl px-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-6 w-6" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {tr("Prêt à réviser autrement ?")}
        </h2>
        <p className="mt-3 text-muted-foreground">
          {tr(
            "Créez votre compte gratuitement et accédez à votre première rotation en quelques secondes.",
          )}
        </p>
        <Button asChild size="lg" className="btn-glow mt-6">
          <Link to="/login">
            {tr("Créer un compte")}
            <ChevronRight className="ml-1 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}

function SiteFooter() {
  const { tr } = useI18n();
  return (
    <footer className="border-t border-border/60 py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-6 text-sm text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-1.5">
          <GraduationCap className="h-4 w-4" />
          <span>Med Apex</span>
        </div>
        <div className="flex items-center gap-4">
          <Link to="/privacy" className="hover:text-foreground hover:underline">
            {tr("Confidentialité")}
          </Link>
          <span>© {new Date().getFullYear()} Med Apex</span>
        </div>
      </div>
    </footer>
  );
}
