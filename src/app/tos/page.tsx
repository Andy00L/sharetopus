// app/terms/page.tsx
"use client";

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
        Conditions d&apos;utilisation de Sharetopus
      </h1>
      <p className="text-sm text-gray-600 mb-6">
        Dernière mise à jour : 05/04/2025
      </p>

      <div className="prose max-w-none">
        <p>Bienvenue sur Sharetopus !</p>

        <p>
          Ces Conditions d&apos;utilisation (&quot;Conditions&quot;) régissent
          votre utilisation du site web Sharetopus à l&apos;adresse{" "}
          <a
            href="https://sharetopus.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com
          </a>{" "}
          (&quot;Site Web&quot;) et les services fournis par Sharetopus. En
          utilisant notre Site Web et nos services, vous acceptez ces
          Conditions.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          1. Description de Sharetopus
        </h2>
        <p>
          Sharetopus est un outil qui permet aux utilisateurs de publier
          simultanément et de télécharger du contenu sur toutes les plateformes
          de médias sociaux à partir d&apos;un seul endroit.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          2. Conditions d&apos;utilisation de YouTube
        </h2>
        <p>
          En utilisant Sharetopus pour interagir avec les services YouTube, vous
          acceptez également d&apos;être lié par les Conditions
          d&apos;utilisation de YouTube (
          <Link
            href="https://www.youtube.com/t/terms"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://www.youtube.com/t/terms
          </Link>
          ). Cela inclut toute utilisation des services API YouTube via notre
          plateforme.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          3. Données utilisateur et confidentialité
        </h2>
        <p>
          Nous collectons et stockons les données des utilisateurs, notamment le
          nom, l&apos;email, les informations de paiement et les clés
          d&apos;accès d&apos;authentification aux réseaux sociaux, selon les
          besoins pour fournir nos services. Pour plus de détails sur la façon
          dont nous traitons vos données, veuillez consulter notre Politique de
          confidentialité à{" "}
          <Link
            href="https://sharetopus.com/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 hover:underline"
          >
            https://sharetopus.com/privacy-policy
          </Link>
          .
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          4. Collecte de données non personnelles
        </h2>
        <p>
          Nous utilisons des cookies web pour collecter des données non
          personnelles dans le but d&apos;améliorer nos services et
          l&apos;expérience utilisateur.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          5. Droits de propriété et d&apos;utilisation
        </h2>
        <p>
          Lorsque vous achetez un forfait sur Sharetopus, vous pouvez vous
          connecter à vos comptes de médias sociaux et autoriser l&apos;accès à
          vos données pour publier sur les plateformes connectées à
          l&apos;application Sharetopus. Vous conservez la propriété de votre
          contenu, mais nous accordez les droits nécessaires pour publier en
          votre nom.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          6. Politique de remboursement
        </h2>
        <p>
          Nous offrons un remboursement complet dans les 24 heures suivant
          l&apos;achat. Pour demander un remboursement, veuillez nous contacter
          à jack@frikit.net.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          7. Confidentialité des enfants
        </h2>
        <p>
          Sharetopus n&apos;est pas destiné à être utilisé par des enfants, et
          nous ne collectons sciemment aucune donnée d&apos;enfants.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          8. Mises à jour des Conditions
        </h2>
        <p>
          Nous pouvons mettre à jour ces Conditions de temps à autre. Les
          utilisateurs seront informés de tout changement par email.
        </p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">9. Loi applicable</h2>
        <p>Ces Conditions sont régies par les lois du Canada.</p>

        <h2 className="text-2xl font-semibold mt-8 mb-4">
          10. Informations de contact
        </h2>
        <p>
          Pour toute question ou préoccupation concernant ces Conditions
          d&apos;utilisation, veuillez nous contacter à{" "}
          <Link
            href="mailto:jack@frikit.net"
            className="text-blue-500 hover:underline"
          >
            jack@frikit.net
          </Link>
          .
        </p>

        <p className="mt-8 font-semibold">Merci d&apos;utiliser Sharetopus !</p>
      </div>
    </div>
  );
}
