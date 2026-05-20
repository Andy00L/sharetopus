import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import { TIER_UPLOAD_LIMITS } from "@/components/core/create/constants/uploadLimits";
import SocialPostForm from "@/components/core/create/SocialPostForm/SocialPostForm";
import RateLimitError from "@/components/RateLimitError";
import { SubscriptionPrompt } from "@/components/SubscriptionPrompt";

import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function SocialPostFormWithData() {
  const { userId } = await auth();

  const isPaid = await checkActiveSubscription(userId);
  if (!isPaid.isActive) {
    return <SubscriptionPrompt />;
  }

  if (!userId) {
    redirect("/sign-in");
  }

  const subscriptionInfo = await checkActiveSubscription(userId);

  if (!subscriptionInfo.isActive || !subscriptionInfo.tier) {
    redirect("/create");
  }

  const accounts = await fetchSocialAccounts(userId, "web", false);

  if (!accounts.success) {
    return <RateLimitError resetIn={accounts.resetIn} />;
  }

  const uploadLimits = TIER_UPLOAD_LIMITS[subscriptionInfo.tier];

  return (
    <SocialPostForm
      accounts={accounts.data ?? []}
      uploadLimits={uploadLimits}
      userId={userId}
      postType="video"
    />
  );
}

export default function CreateVideoPostPage() {
  return (
    <SidebarContent className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Create a video post</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <Suspense fallback={<SocialPostFormSkeleton />}>
          <SocialPostFormWithData />
        </Suspense>
      </div>
    </SidebarContent>
  );
}
