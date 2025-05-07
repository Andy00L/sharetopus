import Link from "next/link";

export default function page() {
  return (
    <div className="container mx-auto px-4 py-6">
      {/* Bouton Retour */}
      <Link
        href="/"
        className="inline-block mb-4 text-blue-500 hover:underline"
      >
        &larr; Retour
      </Link>

      <h1 className="text-3xl font-bold mb-2">
        Politique de Confidentialité de Sharetopus
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Dernière mise à jour : 05/04/2025
      </p>

      <div className="prose max-w-none">
        <p>
          Merci d&apos;utiliser Sharetopus (&quot;nous&quot;, &quot;notre&quot;
          ou &quot;nos&quot;). Cette Politique de Confidentialité décrit comment
          nous collectons, utilisons et protégeons vos informations personnelles
          et non personnelles lorsque vous utilisez notre site web situé à{" "}
          <a
            href="https://sharetopus.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com
          </a>{" "}
          (le &quot;Site Web&quot;).
        </p>

        <p>
          En accédant ou en utilisant le Site Web, vous acceptez les termes de
          cette Politique de Confidentialité. Si vous n&apos;êtes pas
          d&apos;accord avec les pratiques décrites dans cette politique,
          veuillez ne pas utiliser le Site Web.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          1. Informations que nous collectons
        </h2>
        <h3 className="text-xl font-medium mt-6 mb-3">
          1.1 Données personnelles
        </h3>
        <p>Nous collectons les informations personnelles suivantes :</p>
        <ul className="list-disc pl-6 mb-4">
          <li className="mb-2">
            <strong>Nom :</strong> Nous collectons votre nom pour personnaliser
            votre expérience et communiquer efficacement avec vous.
          </li>
          <li className="mb-2">
            <strong>Email :</strong> Nous collectons votre adresse email pour
            vous envoyer des informations importantes concernant votre compte,
            des mises à jour et des communications.
          </li>
          <li className="mb-2">
            <strong>Informations de paiement :</strong> Nous collectons les
            détails de paiement pour traiter vos commandes en toute sécurité.
          </li>
          <li className="mb-2">
            <strong>
              Clés d&apos;accès d&apos;authentification aux réseaux sociaux :
            </strong>{" "}
            Nous collectons ces informations pour permettre la fonctionnalité de
            publication croisée sur vos comptes de réseaux sociaux.
          </li>
        </ul>

        <h3 className="text-xl font-medium mt-6 mb-3">
          1.2 Données non personnelles
        </h3>
        <p>
          Nous utilisons des cookies web pour collecter des informations non
          personnelles telles que votre adresse IP, type de navigateur,
          informations sur l&apos;appareil et habitudes de navigation. Ces
          informations nous aident à améliorer votre expérience de navigation,
          analyser les tendances et améliorer nos services.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          2. Objectif de la collecte de données
        </h2>
        <p>
          Nous collectons et utilisons vos données personnelles pour le
          traitement des commandes et la publication sur les réseaux sociaux.
          Cela comprend le traitement de vos commandes, l&apos;activation de la
          fonctionnalité de publication croisée, l&apos;envoi de confirmations,
          la fourniture d&apos;assistance client et la tenue à jour concernant
          l&apos;état de votre compte et de vos publications.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          3. Services API YouTube
        </h2>
        <p>
          Sharetopus utilise les services API YouTube pour permettre la
          fonctionnalité de publication croisée sur YouTube. En utilisant notre
          service pour interagir avec YouTube, vous êtes également soumis aux
          Conditions d&apos;utilisation de YouTube (
          <Link
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.youtube.com/t/terms
          </Link>
          ).
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          4. Politique de confidentialité de Google
        </h2>
        <p>
          Comme nous utilisons les services API YouTube, vos données peuvent
          également être soumises à la Politique de confidentialité de Google.
          Pour plus d&apos;informations sur la façon dont Google collecte et
          traite les données, veuillez consulter la Politique de confidentialité
          de Google à{" "}
          <Link
            href="http://www.google.com/policies/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            http://www.google.com/policies/privacy
          </Link>
          .
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          5. Partage de données
        </h2>
        <p>
          Nous ne partageons pas vos données personnelles avec d&apos;autres
          parties, sauf si nécessaire pour le traitement des commandes et la
          fonctionnalité de publication sur les réseaux sociaux. Cela peut
          inclure le partage des données nécessaires avec les plateformes de
          réseaux sociaux sur lesquelles vous choisissez de publier, y compris
          YouTube via les services API YouTube.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          6. Confidentialité des enfants
        </h2>
        <p>
          Sharetopus n&apos;est pas destiné aux enfants, et nous ne collectons
          aucune donnée d&apos;enfants.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          7. Mises à jour de la politique de confidentialité
        </h2>
        <p>
          Nous pouvons mettre à jour cette Politique de confidentialité de temps
          à autre. Les utilisateurs seront informés de tout changement par
          email.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          8. Informations de contact
        </h2>
        <p>
          Si vous avez des questions, préoccupations ou demandes concernant
          cette Politique de confidentialité, vous pouvez nous contacter à :
        </p>
        <p>
          <strong>Email :</strong> jack@frikit.net
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          9. Mécanismes de protection des données
        </h2>
        <p>
          Nous prenons la protection de vos données sensibles au sérieux et
          avons mis en place la mesure de sécurité suivante :
        </p>
        <p>
          <strong>a) Chiffrement :</strong> Vos clés d&apos;accès OAuth Google
          sont chiffrées à l&apos;aide de protocoles de chiffrement standards de
          l&apos;industrie, tant en transit qu&apos;au repos.
        </p>
        <p>
          Bien que nous mettions en œuvre cette mesure de sécurité pour protéger
          vos informations sensibles, veuillez noter qu&apos;aucune méthode de
          transmission sur Internet ou méthode de stockage électronique
          n&apos;est sécurisée à 100%. Nous nous efforçons d&apos;utiliser des
          moyens commercialement acceptables pour protéger vos informations
          personnelles, mais nous ne pouvons garantir leur sécurité absolue.
        </p>
        <p>
          En utilisant Sharetopus, vous consentez aux termes de cette Politique
          de confidentialité.
        </p>
      </div>
    </div>
  );
}
