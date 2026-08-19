import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "MedApex — Conditions d'utilisation" },
      {
        name: "description",
        content:
          "Conditions d'utilisation de MedApex : ce que vous pouvez attendre du service, les règles d'utilisation, et les modalités d'abonnement.",
      },
    ],
  }),
  component: TermsOfService,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground space-y-3">{children}</div>
    </section>
  );
}

function TermsOfService() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold mt-4 mb-2">Conditions d'utilisation</h1>
        <p className="text-sm text-muted-foreground mb-10">
          MedApex · Dernière mise à jour :{" "}
          {new Date().toLocaleDateString("fr-FR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        <Section title="1. Objet">
          <p>
            MedApex est une plateforme de révision par QCM, cas cliniques et résumés de cours,
            destinée aux étudiants en médecine suivant le cursus algérien (Externat P1–P6,
            rattrapage, résidanat). En créant un compte ou en utilisant le site, vous acceptez les
            présentes conditions d'utilisation.
          </p>
        </Section>

        <Section title="2. Compte utilisateur">
          <ul className="list-disc pl-5 space-y-1">
            <li>Vous devez fournir une adresse e-mail valide pour créer un compte.</li>
            <li>
              Vous êtes responsable de la confidentialité de vos identifiants et de toute activité
              effectuée depuis votre compte.
            </li>
            <li>Un compte est personnel et ne doit pas être partagé avec d'autres personnes.</li>
          </ul>
        </Section>

        <Section title="3. Contenu et usage pédagogique">
          <p>
            Les QCM, cas cliniques et résumés proposés sont des outils de révision et de préparation
            aux examens. Ils sont fournis à titre pédagogique uniquement et ne constituent pas un
            avis médical, un protocole de soin, ni une source faisant foi en cas de désaccord avec
            le programme officiel de votre faculté. MedApex s'efforce d'assurer l'exactitude du
            contenu, mais ne peut garantir l'absence totale d'erreur — vous pouvez signaler une
            question via la fonction de signalement intégrée.
          </p>
        </Section>

        <Section title="4. Abonnements et paiement">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              Certains contenus sont payants et donnent accès à une année, un pack complet, ou une
              formule spécifique (cours, sessions, ou les deux), pour une durée déterminée affichée
              au moment de l'achat.
            </li>
            <li>
              Le paiement s'effectue par virement ou dépôt selon les moyens indiqués sur la page
              boutique ; vous téléversez un justificatif que notre équipe vérifie manuellement avant
              d'activer l'accès.
            </li>
            <li>
              Certaines offres peuvent être proposées gratuitement à la discrétion de
              l'administration, sans que cela ouvre droit à un remboursement ou une compensation
              pour les utilisateurs ayant déjà payé.
            </li>
            <li>
              Un accès accordé est lié à un compte et n'est ni transférable ni remboursable, sauf
              erreur manifeste de notre part.
            </li>
          </ul>
        </Section>

        <Section title="5. Utilisation autorisée">
          <p>Vous vous engagez à ne pas :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Partager votre compte ou revendre l'accès au contenu à des tiers ;</li>
            <li>
              Copier, extraire ou redistribuer massivement le contenu du site (questions, cas
              cliniques, résumés) en dehors d'un usage personnel de révision ;
            </li>
            <li>
              Tenter de contourner les mécanismes d'accès, de sécurité ou de limitation du service.
            </li>
          </ul>
          <p>
            Un manquement à ces règles peut entraîner la suspension ou la suppression de votre
            compte, sans remboursement.
          </p>
        </Section>

        <Section title="6. Disponibilité du service">
          <p>
            Nous faisons de notre mieux pour maintenir le site disponible, mais ne garantissons pas
            une disponibilité continue sans interruption. Le service peut évoluer (fonctionnalités
            ajoutées, modifiées ou retirées) sans préavis.
          </p>
        </Section>

        <Section title="7. Résiliation">
          <p>
            Vous pouvez cesser d'utiliser MedApex à tout moment et demander la suppression de votre
            compte. Nous pouvons suspendre ou résilier un compte en cas de violation de ces
            conditions.
          </p>
        </Section>

        <Section title="8. Données personnelles">
          <p>
            L'utilisation de vos données personnelles est décrite dans notre{" "}
            <Link to="/privacy" className="text-primary hover:underline">
              politique de confidentialité
            </Link>
            .
          </p>
        </Section>

        <Section title="9. Modifications de ces conditions">
          <p>
            Nous pouvons mettre à jour ces conditions d'utilisation de temps à autre. La date de
            dernière mise à jour est indiquée en haut de cette page. Une utilisation continue du
            service après modification vaut acceptation des nouvelles conditions.
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Pour toute question concernant ces conditions, contactez-nous à :{" "}
            <a
              href="mailto:mustaphabensegueni.med@gmail.com"
              className="text-primary hover:underline"
            >
              mustaphabensegueni.med@gmail.com
            </a>
          </p>
        </Section>
      </div>
    </div>
  );
}
