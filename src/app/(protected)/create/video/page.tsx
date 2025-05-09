import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import SocialPostForm from "@/components/core/create/SocialPostForm";

import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

const SocialPostFormWithData = async () => {
  const { userId } = await auth();
  const isPaid = await checkActiveSubscription(userId);
  if (!isPaid.isActive) {
    return redirect("/#pricing");
  }
  const accounts = await fetchSocialAccounts(userId);

  return (
    <SocialPostForm accounts={accounts} userId={userId} postType="video" />
  );
};
export default function page() {
  return (
    <SidebarContent className="px-4 py-6 ">
      <h1 className="text-2xl font-bold mb-2">Create a video post</h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <Suspense fallback={<SocialPostFormSkeleton />}>
          <SocialPostFormWithData />
        </Suspense>
      </div>
    </SidebarContent>
  );
}
