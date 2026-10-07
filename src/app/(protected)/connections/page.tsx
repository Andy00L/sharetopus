import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import { listShareLinks } from "@/actions/server/share-link/listShareLinks";
import ConnectPlatformButton from "@/components/core/accounts/connectAccountsButton/ConnectPlatformButton";
import { CreateShareLinkDialog } from "@/components/connections/CreateShareLinkDialog";
import { ShareLinkList } from "@/components/connections/ShareLinkList";
import NoAccountsMessage from "@/components/core/accounts/NoAccountsMessage";
import ConnectedAccountsBadge from "@/components/core/accounts/pageUi/ConnectedAccountsBadge";
import PinterestSVGIcon, {
  FacebookSVGIcon,
  InstagramSVGIcon,
  LinkedinSVGIcon,
  TiktokSVGIcon,
  TwitterVGIcon,
  YoutubeSVGIcon,
} from "@/components/icons/allPlatformsIcons";
import { AccountsLoadError } from "@/components/AccountsLoadError";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import AccountsPageSkeleton from "@/components/suspense/account/Placeholders";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { PLATFORM_LABELS, type PostingPlatform } from "@/lib/platforms/capabilities";
import { tierMeets } from "@/lib/types/plans";
import { toClientSocialAccount } from "@/lib/utils/toClientSocialAccount";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, type ComponentType } from "react";

const CONNECT_SECTIONS: readonly { platform: PostingPlatform; Icon: ComponentType }[] = [
  { platform: "tiktok", Icon: TiktokSVGIcon },
  { platform: "instagram", Icon: InstagramSVGIcon },
  { platform: "pinterest", Icon: PinterestSVGIcon },
  { platform: "linkedin", Icon: LinkedinSVGIcon },
  { platform: "youtube", Icon: YoutubeSVGIcon },
  { platform: "x", Icon: TwitterVGIcon },
  { platform: "facebook", Icon: FacebookSVGIcon },
];

const AccountsPageWithData = async () => {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }
  const subscriptionCheck = await checkActiveSubscription(userId);
  if (!subscriptionCheck.isActive) {
    return <InactiveSubscriptionNotice status={subscriptionCheck.status} />;
  }
  const limitsCheck = await checkAccountLimits(userId, subscriptionCheck.tier);
  const canAddMoreAccounts = limitsCheck.success && limitsCheck.canAddMore;
  const isCreatorOrHigher = tierMeets(subscriptionCheck.tier, "creator");

  const fetchResult = await fetchSocialAccounts(userId, "web", false);
  if (!fetchResult.success) {
    return <AccountsLoadError resetIn={fetchResult.resetIn} />;
  }

  // Client-safe projection: full rows would serialize token columns into the RSC payload.
  const accounts = (fetchResult.data ?? []).map(toClientSocialAccount);

  // Share links are a Creator feature; null tells the list the read failed.
  const shareLinksResult = isCreatorOrHigher ? await listShareLinks() : null;
  const shareLinks = shareLinksResult?.success ? shareLinksResult.data : null;

  return (
    <SidebarContent className="px-4 py-6 ">
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold">Manage your social accounts</h1>
        <p className="text-muted-foreground mt-2">
          Connect your social accounts to publish content across multiple
          platforms.
        </p>
        {limitsCheck.success && (
          <div
            className="mt-4 p-3 bg-card
           rounded-md"
          >
            <p className="text-sm">
              <span className="font-medium">
                {limitsCheck.currentCount}
                {limitsCheck.isUnlimited
                  ? " (Unlimited)"
                  : ` / ${limitsCheck.maxAllowed}`}
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
        {CONNECT_SECTIONS.map(({ platform, Icon }, sectionIndex) => {
          const showShareLinks = platform === "tiktok" && isCreatorOrHigher;
          return (
            <div
              key={platform}
              className={sectionIndex === 0 ? "space-y-3" : "space-y-3 pt-4 border-t"}
            >
              <div className="flex items-center gap-6">
                <div className="scale-250">
                  <Icon />
                </div>
                <h2 className="text-xl font-semibold">{PLATFORM_LABELS[platform]}</h2>
                <ConnectPlatformButton
                  platform={platform}
                  canConnect={canAddMoreAccounts}
                  currentCount={limitsCheck.currentCount}
                  maxAllowed={limitsCheck.maxAllowed}
                />
                {showShareLinks && <CreateShareLinkDialog />}
              </div>
              <div className="flex flex-wrap gap-2">
                <ConnectedAccountsBadge
                  accounts={accounts.filter((account) => account.platform === platform)}
                  userId={userId}
                />
              </div>
              {showShareLinks && (
                <div className="mt-3">
                  <ShareLinkList links={shareLinks} />
                </div>
              )}
            </div>
          );
        })}
      </SidebarGroup>

      {accounts.length === 0 && (
        <SidebarGroup className="mt-8 mb-16">
          <NoAccountsMessage />
        </SidebarGroup>
      )}
    </SidebarContent>
  );
};

export default function ManageAccountsPage() {
  return (
    <Suspense fallback={<AccountsPageSkeleton />}>
      <AccountsPageWithData />
    </Suspense>
  );
}
