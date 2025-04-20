import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import ConnectPinterestButton from "@/components/core/accounts/ConnectPinterestButton";
import ConnectTikTokButton from "@/components/core/accounts/ConnectTikTokButton";
import ConnectedAccounts from "@/components/core/accounts/social/connectedAccounts";
import { Button } from "@/components/ui/button";
import { auth } from "@clerk/nextjs/server";

export default async function ManageAccountsPage() {
  const { userId } = await auth();
  const accounts = await fetchSocialAccounts(userId);
  return (
    <div className="container mx-auto px-4 py-6">
      <header className="mb-8">
        <h1 className="text-2xl font-bold">Gérez vos comptes sociaux</h1>
        <p className="text-muted-foreground mt-2">
          Connectez vos comptes sociaux pour publier du contenu sur plusieurs
          plateformes.
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">Connecter un compte TikTok</h2>
        <ConnectTikTokButton />
      </section>
      <section className="mb-8">
        <h2 className="text-xl font-bold mb-4">
          Connecter un compte Pinterest
        </h2>
        <ConnectPinterestButton />
      </section>

      <section className="mt-12 border-t pt-6">
        <ConnectedAccounts initialAccounts={accounts} />
      </section>

      <section className="mt-12 border-t pt-6">
        <h2 className="text-lg font-medium mb-4">
          Besoin d&apos;aide pour connecter vos comptes ?
        </h2>
        <p className="text-muted-foreground mb-6">
          Si vous rencontrez des problèmes en connectant vos comptes, consultez
          notre guide de dépannage ou contactez le support.
        </p>
        <div className="flex gap-4">
          <Button variant="outline">Voir le guide de dépannage</Button>
          <Button variant="secondary">Contacter le support</Button>
        </div>
      </section>
    </div>
  );
}
