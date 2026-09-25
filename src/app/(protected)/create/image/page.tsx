import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import { TIER_UPLOAD_LIMITS } from "@/components/core/create/constants/uploadLimits";
import SocialPostForm from "@/components/core/create/SocialPostForm/SocialPostForm";
import {
  parseSchedulePrefill,
  type SchedulePrefill,
} from "@/components/core/create/SocialPostForm/state/parseSchedulePrefill";
import { AccountsLoadError } from "@/components/AccountsLoadError";
import { InactiveSubscriptionNotice } from "@/components/InactiveSubscriptionNotice";
import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { toClientSocialAccount } from "@/lib/utils/toClientSocialAccount";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function SocialPostFormWithData({
  initialSchedule,
}: {
  readonly initialSchedule: SchedulePrefill | null;
}) {
  const { userId } = await auth();
  const subscription = await checkActiveSubscription(userId);
  if (!subscription.isActive) {
    return <InactiveSubscriptionNotice status={subscription.status} />;
  }
  if (!userId || !subscription.tier) {
    redirect("/create");
  }

  const accounts = await fetchSocialAccounts(userId, "web", false);

  if (!accounts.success) {
    return <AccountsLoadError resetIn={accounts.resetIn} />;
  }

  const uploadLimits = TIER_UPLOAD_LIMITS[subscription.tier];

  return (
    <SocialPostForm
      accounts={(accounts.data ?? []).map(toClientSocialAccount)}
      uploadLimits={uploadLimits}
      userId={userId}
      postType="image"
      initialSchedule={initialSchedule}
    />
  );
}

export default async function CreateImagePostPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ date?: string; time?: string }>;
}) {
  const { date, time } = await searchParams;
  const initialSchedule = parseSchedulePrefill(date, time);

  return (
    <SidebarContent className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Create a image post</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <Suspense fallback={<SocialPostFormSkeleton />}>
          <SocialPostFormWithData initialSchedule={initialSchedule} />
        </Suspense>
      </div>
    </SidebarContent>
  );
}
