import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import SocialPostForm from "@/components/core/create/SocialPostForm";
import RateLimitError from "@/components/RateLimitError";
import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

async function SocialPostFormWithData() {
  const { userId } = await auth();

  const subscriptionInfo = await checkActiveSubscription(userId);

  if (!subscriptionInfo.isActive || !subscriptionInfo.plan) {
    redirect("/create");
  }

  const accounts = await fetchSocialAccounts(userId);

  if (!accounts.success) {
    return <RateLimitError resetIn={accounts.resetIn} />;
  }

  return (
    <SocialPostForm
      accounts={accounts.data ?? []}
      userId={userId}
      postType="text"
      planId={subscriptionInfo.plan}
    />
  );
}

export default function CreateTestPostPage() {
  return (
    <SidebarContent className="px-4 py-6">
      <h1 className="text-2xl font-bold mb-2">Create a text post</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <Suspense fallback={<SocialPostFormSkeleton />}>
          <SocialPostFormWithData />
        </Suspense>
      </div>
    </SidebarContent>
  );
}
