import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import SocialPostForm from "@/components/core/create/SocialPostForm";
import { auth } from "@clerk/nextjs/server";

export default async function CreatePostPage() {
  const { userId } = await auth();
  const accounts = await fetchSocialAccounts(userId);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Create a Social Media Post</h1>
      <div className="max-w-3xl mx-auto">
        <SocialPostForm accounts={accounts} userId={userId} />
      </div>
    </div>
  );
}
