import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import ConnectPinterestButton from "@/components/core/accounts/ConnectSocialAccounts/ConnectPinterestButton";
import ConnectTikTokButton from "@/components/core/accounts/ConnectSocialAccounts/ConnectTikTokButton";
import ConnectedAccountsBadge from "@/components/core/accounts/pageUi/ConnectedAccountsBadge";
import NoAccountsMessage from "@/components/core/accounts/NoAccountsMessage";
import { auth } from "@clerk/nextjs/server";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";

export default async function ManageAccountsPage() {
  const { userId } = await auth();
  const accounts = await fetchSocialAccounts(userId);

  // Filter accounts by platform
  const tiktokAccounts = accounts.filter((acc) => acc.platform === "tiktok");
  const pinterestAccounts = accounts.filter(
    (acc) => acc.platform === "pinterest"
  );

  return (
    <SidebarContent className="container mx-auto px-4 py-6 flex flex-col min-h-screen">
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold">Gérez vos comptes sociaux</h1>
        <p className="text-muted-foreground mt-2">
          Connectez vos comptes sociaux pour publier du contenu sur plusieurs
          plateformes.
        </p>
      </SidebarGroup>

      <SidebarGroup className="mb-8 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">TikTok</h2>
            <ConnectTikTokButton />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge accounts={tiktokAccounts} userId={userId} />
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Pinterest</h2>
            <ConnectPinterestButton />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge
              accounts={pinterestAccounts}
              userId={userId}
            />
          </div>
        </div>
      </SidebarGroup>

      {accounts.length === 0 && (
        <SidebarGroup className="mt-8 mb-16">
          <NoAccountsMessage />
        </SidebarGroup>
      )}
    </SidebarContent>
  );
}
