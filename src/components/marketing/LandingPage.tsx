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
        <ExampleResume
          title={tr("Exemple de résumé de cours — Neurologie")}
          badge={tr("Neurologie")}
          html={NEURO_RESUME_HTML}
        />
        <ExampleResume
          title={tr("Exemple de résumé de cours — Pneumologie (4e année)")}
          badge={tr("Pneumologie")}
          html={PNEUMO_RESUME_HTML}
        />
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

/**
 * Real excerpts (markup, CSS, and hand-drawn SVG figures) lifted verbatim
 * from actual uploaded résumé HTML files, scoped under a unique wrapper
 * class so their styles can't leak into the rest of the app.
 */
const NEURO_RESUME_HTML = `
<div class="res-neuro">
  <style>
    .res-neuro{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; background:#fffbf0; color:#332703; border-radius:12px; padding:20px; }
    .res-neuro .lesson-head{ margin-bottom:14px; }
    .res-neuro .lesson-head h2{ font-size:1.1rem; margin:0; color:#3a2a05; font-weight:700; }
    .res-neuro .def-card{ border-left:3px solid #c99414; background:#fff; border-radius:8px; padding:12px 14px; margin-bottom:14px; }
    .res-neuro .def-card .term{ font-weight:700; color:#523c08; font-size:.95rem; display:block; margin-bottom:3px; }
    .res-neuro .def-card p{ font-size:.87rem; color:#7a6a3e; margin:0; }
    .res-neuro .fig-row{ display:flex; justify-content:center; margin:6px 0 14px; }
    .res-neuro figure.xray-fig{ margin:0; max-width:220px; background:#3a2a05; border-radius:12px; padding:10px; box-shadow:0 4px 14px rgba(10,40,65,.18); }
    .res-neuro figure.xray-fig svg{ width:100%; height:auto; display:block; border-radius:6px; }
    .res-neuro figure.xray-fig figcaption{ color:#fcf3d9; font-size:.72rem; text-align:center; padding:8px 4px 2px; line-height:1.35; }
    .res-neuro figure.xray-fig figcaption b{ color:#fff; display:block; font-size:.76rem; margin-bottom:2px; }
    .res-neuro .callout{ border-radius:10px; padding:12px 15px; font-size:.85rem; background:#523c08; color:#fcf3d9; }
    .res-neuro .callout .k{ font-size:.62rem; letter-spacing:.08em; text-transform:uppercase; color:#f3d484; display:block; margin-bottom:4px; font-weight:700; }
  </style>
  <div class="lesson-head"><h2>Rappel anatomique du SNC</h2></div>
  <div class="def-card"><span class="term">Système nerveux central (SNC)</span><p>SNC (ou névraxe) = encéphale (cerveau + cervelet + tronc cérébral) + moelle spinale.</p></div>
  <div class="fig-row"><figure class="xray-fig">
  <svg viewBox="0 0 320 280" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Coupe sagittale de l'encéphale">
<defs>
  <radialGradient id="pgch1fig1" cx="50%" cy="38%" r="75%">
    <stop offset="0%" stop-color="#4a3609"/>
    <stop offset="55%" stop-color="#2f2205"/>
    <stop offset="100%" stop-color="#1f1603"/>
  </radialGradient>
  <linearGradient id="tissuech1fig1" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#f4ead0" stop-opacity="0.92"/>
    <stop offset="100%" stop-color="#d6c69a" stop-opacity="0.82"/>
  </linearGradient>
</defs>
<rect x="0" y="0" width="320" height="280" rx="10" fill="url(#pgch1fig1)"/>
<path d="M 62 108 C 60 78, 88 58, 122 50 C 150 44, 178 44, 200 54 C 222 44, 244 52, 250 74 C 258 84, 256 100, 246 108 C 256 118, 254 138, 240 148 C 244 162, 234 178, 216 182 C 210 196, 192 204, 176 198 C 160 210, 138 208, 128 196 C 108 198, 90 188, 84 172 C 68 168, 58 154, 62 138 C 52 130, 52 116, 62 108 Z" fill="url(#tissuech1fig1)" stroke="#8a7550" stroke-width="1.2"/>
<path d="M 78 72 Q 95 62 115 64 M 90 90 Q 110 80 132 82 M 76 106 Q 98 98 120 100 M 82 128 Q 104 122 126 126" fill="none" stroke="#8a7550" stroke-width="0.8" opacity="0.4"/>
<path d="M 150 52 Q 165 66 160 84 M 175 50 Q 190 66 184 86 M 200 56 Q 214 70 210 90" fill="none" stroke="#8a7550" stroke-width="0.8" opacity="0.4"/>
<path d="M 210 100 Q 228 96 240 104 M 214 120 Q 232 118 244 126 M 208 140 Q 224 140 234 148" fill="none" stroke="#8a7550" stroke-width="0.8" opacity="0.4"/>
<path d="M 96 128 Q 130 138 158 130" fill="none" stroke="#5c4a24" stroke-width="1.4" opacity="0.55"/>
<path d="M 155 50 Q 148 78 158 106" fill="none" stroke="#5c4a24" stroke-width="1.4" opacity="0.5"/>
<path d="M 196 158 Q 216 148 234 158 Q 246 168 240 184 Q 234 198 214 196 Q 198 192 192 178 Q 188 166 196 158 Z" fill="#c8b585" opacity="0.88" stroke="#8a7550" stroke-width="0.8"/>
<path d="M 200 164 Q 214 160 226 166 M 197 174 Q 214 170 230 176 M 199 184 Q 214 183 226 188" fill="none" stroke="#5c4a24" stroke-width="0.7" opacity="0.6"/>
<path d="M 168 178 Q 164 195 172 210 Q 177 217 184 214 Q 189 197 184 180 Q 178 174 168 178 Z" fill="#b8a575" opacity="0.88" stroke="#8a7550" stroke-width="0.8"/>
<path d="M 176 212 L 172 232" stroke="#b8a575" stroke-width="7" opacity="0.7" stroke-linecap="round"/>
<ellipse cx="108" cy="100" rx="32" ry="28" fill="#e0aa1e" opacity="0.58"/><ellipse cx="168" cy="78" rx="30" ry="22" fill="#c99414" opacity="0.58"/><ellipse cx="140" cy="145" rx="32" ry="22" fill="#eec052" opacity="0.58"/><ellipse cx="215" cy="100" rx="24" ry="26" fill="#a67a10" opacity="0.58"/>
</svg>
  <figcaption><b>Les 4 lobes cérébraux</b>Vue sagittale : frontal, pariétal, temporal et occipital, délimités par les scissures de Sylvius et de Rolando.</figcaption>
</figure></div>
  <div class="callout"><span class="k">Remarque</span>Dans la profondeur de la scissure de Sylvius se trouve un 5<sup>e</sup> lobe : le lobe de l'insula.</div>
</div>
`;

const PNEUMO_RESUME_HTML = `
<div class="res-pneumo">
  <style>
    .res-pneumo{ font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; background:#eef4f8; color:#132538; border-radius:12px; padding:20px; }
    .res-pneumo .lesson-head{ margin-bottom:4px; }
    .res-pneumo .lesson-head h2{ font-size:1.1rem; margin:0; color:#0b2338; font-weight:700; }
    .res-pneumo .lesson-head .source{ display:block; font-size:.71rem; color:#5c7186; margin-top:2px; }
    .res-pneumo .def-card{ border-left:3px solid #1c3c56; background:#fff; border-radius:8px; padding:12px 14px; margin:12px 0 14px; }
    .res-pneumo .def-card .term{ font-weight:700; color:#0f2e49; font-size:.95rem; display:block; margin-bottom:3px; }
    .res-pneumo .def-card p{ font-size:.87rem; color:#3d5164; margin:0; }
    .res-pneumo .fig-row{ display:flex; justify-content:center; margin:6px 0 4px; }
    .res-pneumo figure.xray-fig{ margin:0; max-width:220px; background:#0b2338; border-radius:12px; padding:10px; box-shadow:0 4px 14px rgba(10,40,65,.18); }
    .res-pneumo figure.xray-fig svg{ width:100%; height:auto; display:block; border-radius:6px; }
    .res-pneumo figure.xray-fig figcaption{ color:#dce9f2; font-size:.72rem; text-align:center; padding:8px 4px 2px; line-height:1.35; }
    .res-pneumo figure.xray-fig figcaption b{ color:#fff; display:block; font-size:.76rem; margin-bottom:2px; }
  </style>
  <div class="lesson-head"><h2>Pneumonies aiguës communautaires</h2><span class="source">Cours de Pneumologie, 4e année Alger</span></div>
  <div class="def-card"><span class="term">Pneumonies aiguës communautaires (PAC)</span><p>Infections du parenchyme pulmonaire, d'évolution aiguë, prises en charge en ambulatoire ou en milieu hospitalier depuis moins de 48&nbsp;heures.</p></div>
  <div class="fig-row"><figure class="xray-fig">
  <svg viewBox="0 0 320 260" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Pneumocoque — PFLA. Opacité dense, homogène, systématisée (lobe), avec bronchogramme aérique (clartés tubulées).">
<defs>
  <radialGradient id="filmgradlp" cx="50%" cy="38%" r="75%">
    <stop offset="0%" stop-color="#1c3c56"/>
    <stop offset="55%" stop-color="#0f2536"/>
    <stop offset="100%" stop-color="#081722"/>
  </radialGradient>
  <linearGradient id="heartlp" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="#f2f6f4" stop-opacity="0.92"/>
    <stop offset="100%" stop-color="#c9d6d6" stop-opacity="0.8"/>
  </linearGradient>
</defs>
<rect x="0" y="0" width="320" height="280" rx="10" fill="url(#filmgradlp)"/>
<path d="M 160 26 L 160 250" stroke="#a9c3d6" stroke-width="6" opacity="0.16"/>
<path d="M 118 40 L 78 62 M 202 40 L 242 62" stroke="#dce9f2" stroke-width="2.2" opacity="0.4" fill="none"/>
<path d="M 62 66 Q 40 130 46 224 Q 60 250 96 236 Q 74 150 84 90 Q 92 66 62 66 Z" fill="#152f45" opacity="0.55"/>
<path d="M 258 66 Q 280 130 274 224 Q 260 250 224 236 Q 246 150 236 90 Q 228 66 258 66 Z" fill="#152f45" opacity="0.55"/>
<path d="M 160 48.0 C 82.0 38.0, 96.0 76.7, 70.0 86.9" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 48.0 C 238.0 38.0, 224.0 76.7, 250.0 86.9" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 73.0 C 83.3 63.0, 94.3 110.5, 69.0 125.5" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 73.0 C 236.7 63.0, 225.7 110.5, 251.0 125.5" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 98.0 C 84.7 88.0, 92.7 144.3, 68.0 164.1" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 98.0 C 235.3 88.0, 227.3 144.3, 252.0 164.1" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 123.0 C 86.0 113.0, 91.0 178.1, 67.0 202.7" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 123.0 C 234.0 113.0, 229.0 178.1, 253.0 202.7" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 148.0 C 87.3 138.0, 89.3 211.9, 66.0 241.3" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 148.0 C 232.7 138.0, 230.7 211.9, 254.0 241.3" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 173.0 C 88.7 163.0, 87.7 245.7, 65.0 279.9" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 173.0 C 231.3 163.0, 232.3 245.7, 255.0 279.9" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 198.0 C 90.0 188.0, 86.0 279.5, 64.0 318.5" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/><path d="M 160 198.0 C 230.0 188.0, 234.0 279.5, 256.0 318.5" fill="none" stroke="#dce9f2" stroke-width="1.1" opacity="0.34"/>
<path d="M 138 92 Q 118 150 130 220 Q 150 244 178 232 Q 196 170 186 106 Q 176 84 138 92 Z" fill="url(#heartlp)"/>
<path d="M 154 30 L 154 58 M 166 30 L 166 58" stroke="#dce9f2" stroke-width="3" opacity="0.5"/>
<path d="M 46 224 Q 100 250 160 238 Q 220 258 274 220 L 274 280 L 46 280 Z" fill="#0c2438"/><path d="M 46 224 Q 100 250 160 238 Q 220 258 274 220" fill="none" stroke="#eef6fb" stroke-width="2.4"/>
<path d="M 190 96 Q 232 100 240 140 Q 246 178 214 200 Q 182 210 168 182 Q 158 140 172 108 Q 178 98 190 96 Z" fill="#eef3ee" opacity="0.94"/>
<path d="M 196 112 L 196 186 M 210 108 L 214 190 M 224 118 L 228 182" stroke="#0f2536" stroke-width="2" opacity="0.55" stroke-linecap="round"/>
</svg>
  <figcaption><b>Pneumocoque — PFLA</b>Opacité dense, homogène, systématisée (lobe), avec bronchogramme aérique (clartés tubulées).</figcaption>
</figure></div>
</div>
`;

function ExampleResume({ title, badge, html }: { title: string; badge: string; html: string }) {
  const { tr } = useI18n();
  return (
    <div>
      <ExampleLabel icon={FileText} label={title} />
      <Card className="surface-card border-0 shadow-none">
        <CardContent className="pt-6">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{badge}</Badge>
            <Badge variant="outline">{tr("Résumé")}</Badge>
          </div>
          {/* Verbatim markup/CSS/SVG from an actual uploaded résumé file, not a mockup. */}
          <div dangerouslySetInnerHTML={{ __html: html }} />
          <p className="mt-3 text-xs text-muted-foreground">
            {tr(
              "Extrait fidèle (mise en forme, illustration et texte) d'un résumé réellement disponible sur la plateforme.",
            )}
          </p>
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
