import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccountsProtected } from "@/actions/functionWithRateLimit";
import ConnectLinkedInButton from "@/components/core/accounts/ConnectSocialAccounts/ConnectLinkedInButton";
import ConnectPinterestButton from "@/components/core/accounts/ConnectSocialAccounts/ConnectPinterestButton";
import ConnectTikTokButton from "@/components/core/accounts/ConnectSocialAccounts/ConnectTikTokButton";
import NoAccountsMessage from "@/components/core/accounts/NoAccountsMessage";
import ConnectedAccountsBadge from "@/components/core/accounts/pageUi/ConnectedAccountsBadge";
import PinterestSVGIcon, {
  LinkedinSVGIcon,
  TiktokSVGIcon,
} from "@/components/icons/allPlatformsIcons";
import RateLimitError from "@/components/RateLimitError";
import AccountsPageSkeleton from "@/components/suspense/account/Placeholders";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

const AccountsPageWithData = async () => {
  const { userId } = await auth();
  const fetchResult = await fetchSocialAccountsProtected(userId);
  const subscriptionActive = await checkActiveSubscription(userId);
  if (!subscriptionActive.isActive) {
    return <RateLimitError />;
  }
  if (!fetchResult.success) {
    return <RateLimitError />;
  }
  const accounts = fetchResult.data!;

  // Filter accounts by platform
  const tiktokAccounts = accounts.filter((acc) => acc.platform === "tiktok");
  const pinterestAccounts = accounts.filter(
    (acc) => acc.platform === "pinterest"
  );
  const linkedinAccounts = accounts.filter(
    (acc) => acc.platform === "linkedin"
  );

  return (
    <SidebarContent className="px-4 py-6 ">
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold">Gérez vos comptes sociaux</h1>
        <p className="text-muted-foreground mt-2">
          Connectez vos comptes sociaux pour publier du contenu sur plusieurs
          plateformes.
        </p>
      </SidebarGroup>

      <SidebarGroup className="mb-8 space-y-6">
        <div className="space-y-3">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <TiktokSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">TikTok</h2>
            <ConnectTikTokButton />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge accounts={tiktokAccounts} userId={userId} />
          </div>
        </div>

        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <PinterestSVGIcon />
            </div>

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

        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <LinkedinSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">Linkedin</h2>
            <ConnectLinkedInButton />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge
              accounts={linkedinAccounts}
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
};

// Main page component with Suspense
export default function ManageAccountsPage() {
  return (
    <Suspense fallback={<AccountsPageSkeleton />}>
      <AccountsPageWithData />
    </Suspense>
  );
}
