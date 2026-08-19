import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "MedApex — Politique de confidentialité" },
      {
        name: "description",
        content:
          "Politique de confidentialité de MedApex : quelles données nous collectons, pourquoi, et comment vous pouvez les gérer.",
      },
    ],
  }),
  component: PrivacyPolicy,
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-xl font-semibold mb-3">{title}</h2>
      <div className="text-sm leading-relaxed text-muted-foreground space-y-3">{children}</div>
    </section>
  );
}

function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-6 py-12">
        <Link to="/" className="text-sm text-primary hover:underline">
          ← Retour à l'accueil
        </Link>

        <h1 className="text-3xl font-bold mt-4 mb-2">Politique de confidentialité</h1>
        <p className="text-sm text-muted-foreground mb-10">
          MedApex · Dernière mise à jour :{" "}
          {new Date().toLocaleDateString("fr-FR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        <Section title="1. Qui nous sommes">
          <p>
            MedApex est une plateforme de révision par QCM destinée aux étudiants en médecine
            (format Externat Alger). Cette politique explique quelles données nous collectons,
            pourquoi, et comment vous pouvez les gérer.
          </p>
        </Section>

        <Section title="2. Données que nous collectons">
          <p>Nous collectons uniquement les données nécessaires au fonctionnement du service :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Compte :</strong> adresse e-mail et, si vous utilisez la connexion Google,
              votre nom et votre photo de profil tels que fournis par Google.
            </li>
            <li>
              <strong>Utilisation :</strong> votre progression dans les modules et questions, vos
              scores, et vos réponses aux QCM, afin d'assurer le suivi de votre parcours.
            </li>
            <li>
              <strong>Paiement :</strong> si vous souscrivez à un accès payant, un justificatif de
              paiement que vous téléversez vous-même (ex. capture d'écran de virement). Nous ne
              collectons ni ne stockons vos coordonnées bancaires.
            </li>
            <li>
              <strong>Journalisation technique :</strong> des journaux d'activité administrative
              (audit) pour la sécurité et la traçabilité du service.
            </li>
          </ul>
        </Section>

        <Section title="3. Comment nous utilisons vos données">
          <ul className="list-disc pl-5 space-y-1">
            <li>Faire fonctionner votre compte et sauvegarder votre progression ;</li>
            <li>Vous donner accès aux modules et contenus correspondant à votre abonnement ;</li>
            <li>Assurer la sécurité de la plateforme et prévenir les abus ;</li>
            <li>Communiquer avec vous en cas de besoin lié à votre compte ou votre paiement.</li>
          </ul>
          <p>Nous ne vendons pas vos données et ne les partageons pas à des fins publicitaires.</p>
        </Section>

        <Section title="4. Connexion avec Google">
          <p>
            Si vous choisissez de vous connecter avec Google, nous recevons de Google votre adresse
            e-mail, votre nom et votre photo de profil, dans le seul but de créer et sécuriser votre
            compte MedApex. Nous ne demandons accès à aucune autre donnée de votre compte Google
            (contacts, agenda, fichiers, etc.).
          </p>
        </Section>

        <Section title="5. Où sont stockées vos données">
          <p>
            Vos données sont hébergées chez Supabase (base de données et authentification) au sein
            de l'Union européenne, et le site est déployé via Vercel. Ces prestataires agissent
            comme sous-traitants techniques et n'utilisent pas vos données à leurs propres fins.
          </p>
        </Section>

        <Section title="6. Vos droits">
          <p>Vous pouvez à tout moment :</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Consulter les données associées à votre compte ;</li>
            <li>Demander la correction ou la suppression de vos données ;</li>
            <li>Demander la suppression complète de votre compte.</li>
          </ul>
          <p>Pour exercer ces droits, contactez-nous à l'adresse indiquée ci-dessous.</p>
        </Section>

        <Section title="7. Conservation des données">
          <p>
            Nous conservons vos données tant que votre compte est actif. Si vous demandez la
            suppression de votre compte, vos données personnelles sont supprimées dans un délai
            raisonnable, sauf obligation légale de conservation plus longue (ex. données de
            facturation).
          </p>
        </Section>

        <Section title="8. Cookies">
          <p>
            MedApex utilise uniquement des cookies techniques nécessaires au fonctionnement du site
            (maintien de votre session de connexion). Nous n'utilisons pas de cookies publicitaires
            ou de suivi tiers.
          </p>
        </Section>

        <Section title="9. Modifications de cette politique">
          <p>
            Nous pouvons mettre à jour cette politique de confidentialité de temps à autre. La date
            de dernière mise à jour est indiquée en haut de cette page.
          </p>
        </Section>

        <Section title="Conditions d'utilisation">
          <p>
            Les règles d'utilisation du service (abonnements, usage autorisé, résiliation) sont
            décrites dans nos{" "}
            <Link to="/terms" className="text-primary hover:underline">
              conditions d'utilisation
            </Link>
            .
          </p>
        </Section>

        <Section title="10. Contact">
          <p>
            Pour toute question concernant cette politique ou vos données personnelles,
            contactez-nous à :{" "}
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
