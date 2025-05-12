import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import { PRICE_ID_UPLOAD_LIMITS } from "@/components/core/create/constants/uploadLimits";
import SocialPostForm from "@/components/core/create/SocialPostForm";
import RateLimitError from "@/components/RateLimitError";
import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

const SocialPostFormWithData = async () => {
  const { userId } = await auth();
  const subscriptionInfo = await checkActiveSubscription(userId);
  if (!subscriptionInfo.isActive) {
    redirect("/create");
  }
  const accounts = await fetchSocialAccounts(userId);
  if (!accounts.success) {
    return <RateLimitError resetIn={accounts.resetIn} />;
  }
  const planId = subscriptionInfo.plan;

  const uploadLimits = PRICE_ID_UPLOAD_LIMITS[planId!];
  return (
    <SocialPostForm
      accounts={accounts.data!}
      uploadLimits={uploadLimits}
      userId={userId}
      postType="image"
    />
  );
};
export default function page() {
  return (
    <SidebarContent className="px-4 py-6 ">
      <h1 className="text-2xl font-bold mb-2">Create a image post</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <Suspense fallback={<SocialPostFormSkeleton />}>
          <SocialPostFormWithData />
        </Suspense>
      </div>
    </SidebarContent>
  );
}
