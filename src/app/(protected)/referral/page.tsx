import { getReferralSummary } from "@/actions/server/referral/getReferralSummary";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CopyLinkButton } from "./copy-link-button";

/**
 * Referral page: shows the user's referral link, progress, and earned weeks.
 *
 * Server component; inherits the protected layout + auth from (protected)/layout.tsx.
 * All data is loaded via getReferralSummary which calls ensureReferralCode as
 * a lazy fallback.
 */
export default async function ReferralPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect("/sign-in");
  }

  const headerList = await headers();
  const host = headerList.get("host") ?? "sharetopus.com";
  const protocol = headerList.get("x-forwarded-proto") ?? "https";
  const origin = `${protocol}://${host}`;

  const summary = await getReferralSummary(userId, origin);

  if (!summary.success) {
    return (
      <SidebarContent className="px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">Refer & Earn</h1>
        <p className="text-muted-foreground">
          Something went wrong loading your referral data. Please try again
          later.
        </p>
      </SidebarContent>
    );
  }

  const hasActiveReferralAccess =
    summary.creatorAccessUntil &&
    new Date(summary.creatorAccessUntil) > new Date();

  return (
    <SidebarContent className="px-4 py-6">
      <SidebarGroup className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Refer & Earn</h1>
        <p className="text-muted-foreground mb-6">
          Refer 3 people to earn 1 free week of Creator access. Up to 5 weeks
          total.
        </p>

        {/* Share link */}
        <div className="rounded-lg border p-4 mb-6">
          <p className="text-sm font-medium mb-2">Your referral link</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-muted px-3 py-2 text-sm font-mono truncate">
              {summary.shareLink}
            </code>
            <CopyLinkButton link={summary.shareLink} />
          </div>
        </div>

        {/* Progress */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border p-4 text-center">
            <p className="text-3xl font-bold text-[#FF4A20]">
              {summary.towardNextWeek}/3
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Toward next week
            </p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-3xl font-bold">
              {summary.totalVerified}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Total referrals
            </p>
          </div>
          <div className="rounded-lg border p-4 text-center">
            <p className="text-3xl font-bold">
              {summary.weeksEarned}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Weeks earned
            </p>
          </div>
        </div>

        {/* Status messages */}
        {hasActiveReferralAccess && (
          <div className="rounded-lg border border-[#FF4A20]/30 bg-[#FF4A20]/5 p-4 mb-4">
            <p className="text-sm font-medium">
              Creator access from referrals until{" "}
              <span className="font-bold">
                {new Date(summary.creatorAccessUntil!).toLocaleDateString(
                  undefined,
                  { year: "numeric", month: "long", day: "numeric" },
                )}
              </span>
            </p>
          </div>
        )}

        {summary.capReached && (
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium text-muted-foreground">
              You have earned the maximum 5 free weeks. Thank you for spreading
              the word!
            </p>
          </div>
        )}
      </SidebarGroup>
    </SidebarContent>
  );
}
