import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import ConnectLinkedInButton from "@/components/core/accounts/connectAccountsButton/ConnectLinkedInButton";
import ConnectPinterestButton from "@/components/core/accounts/connectAccountsButton/ConnectPinterestButton";
import ConnectTikTokButton from "@/components/core/accounts/connectAccountsButton/ConnectTikTokButton";
import NoAccountsMessage from "@/components/core/accounts/NoAccountsMessage";
import ConnectedAccountsBadge from "@/components/core/accounts/pageUi/ConnectedAccountsBadge";
import PinterestSVGIcon, {
  LinkedinSVGIcon,
  TiktokSVGIcon,
} from "@/components/icons/allPlatformsIcons";
import RateLimitError from "@/components/RateLimitError";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";
import AccountsPageSkeleton from "@/components/suspense/account/Placeholders";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { Suspense } from "react";

const AccountsPageWithData = async () => {
  const { userId } = await auth();
  const subscriptionCheck = await checkActiveSubscription(userId);
  if (!subscriptionCheck.isActive || !subscriptionCheck.success) {
    return <SubscriptionPrompt />;
  }
  const limitsCheck = await checkAccountLimits(userId, subscriptionCheck.plan);
  const canAddMoreAccounts = limitsCheck.success && limitsCheck.canAddMore;

  const fetchResult = await fetchSocialAccounts(userId, false);
  if (!fetchResult.success) {
    return <RateLimitError resetIn={fetchResult.resetIn} />;
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
  {
    /* 
  const instagramAccounts = accounts.filter(
    (acc) => acc.platform === "instagram"
  );
  */
  }

  return (
    <SidebarContent className="px-4 py-6 ">
      {/* Account information and limit display */}
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold">Manage your social accounts</h1>
        <p className="text-muted-foreground mt-2">
          Connect your social accounts to publish content across multiple
          platforms.
        </p>
        {/* Account limits display */}
        {limitsCheck.success && (
          <div
            className="mt-4 p-3 bg-white
           rounded-md"
          >
            <p className="text-sm">
              <span className="font-medium">
                {limitsCheck.currentCount}{" "}
                {limitsCheck.maxAllowed < 30 && ` / ${limitsCheck.maxAllowed}`}
              </span>{" "}
              connected accounts
            </p>
            {!limitsCheck.canAddMore && (
              <p className="text-xs text-destructive mt-1">
                You have reached the account limit for your subscription.
                <Link
                  href="/#pricing"
                  className="text-primary font-medium ml-1 hover:underline"
                >
                  Upgrade
                </Link>
              </p>
            )}
          </div>
        )}
      </SidebarGroup>

      <SidebarGroup className="mb-8 space-y-6">
        {/* TikTok */}
        <div className="space-y-3">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <TiktokSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">TikTok</h2>
            <ConnectTikTokButton
              canConnect={canAddMoreAccounts}
              currentCount={limitsCheck.currentCount}
              maxAllowed={limitsCheck.maxAllowed}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge accounts={tiktokAccounts} userId={userId} />
          </div>
        </div>

        {/* Instagram */}
        {/*
        <div className="space-y-3">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <InstagramSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">Instagram</h2>
            <ConnectInstagramButton
              canConnect={canAddMoreAccounts}
              currentCount={limitsCheck.currentCount}
              maxAllowed={limitsCheck.maxAllowed}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge
              accounts={instagramAccounts}
              userId={userId}
            />
          </div>
        </div>
        */}

        {/* Pinterest */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <PinterestSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">Pinterest</h2>
            <ConnectPinterestButton
              canConnect={canAddMoreAccounts}
              currentCount={limitsCheck.currentCount}
              maxAllowed={limitsCheck.maxAllowed}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ConnectedAccountsBadge
              accounts={pinterestAccounts}
              userId={userId}
            />
          </div>
        </div>

        {/* Linkedin */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center gap-6">
            <div className="scale-250">
              <LinkedinSVGIcon />
            </div>

            <h2 className="text-xl font-semibold">Linkedin</h2>
            <ConnectLinkedInButton
              canConnect={canAddMoreAccounts}
              currentCount={limitsCheck.currentCount}
              maxAllowed={limitsCheck.maxAllowed}
            />
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
