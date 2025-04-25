import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import SocialPostForm from "@/components/core/create/SocialPostForm";
import { SidebarContent } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";

export default async function CreatePostPage() {
  const { userId } = await auth();
  const accounts = await fetchSocialAccounts(userId);

  return (
    <SidebarContent className="px-4 py-6 ">
      <h1 className="text-2xl font-bold mb-6">Create a Social Media Post</h1>
      <SocialPostForm accounts={accounts} userId={userId} />
    </SidebarContent>
  );
}
