import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import SocialPostForm from "@/components/core/create/SocialPostForm";
import SocialPostFormSkeleton from "@/components/suspense/create/SocialPostFormSkeleton";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { Suspense } from "react";

const SocialPostFormWithData = async () => {
  const { userId } = await auth();
  const accounts = await fetchSocialAccounts(userId);

  return <SocialPostForm accounts={accounts} userId={userId} />;
};

export default async function CreatePostPage() {
  return (
    <SidebarContent className="px-4 py-6 ">
      <h1 className="text-2xl font-bold mb-6">Create a Social Media Post</h1>
      <Suspense fallback={<SocialPostFormSkeleton />}>
        <SocialPostFormWithData />
      </Suspense>{" "}
    </SidebarContent>
  );
}
