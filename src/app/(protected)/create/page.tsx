// src/app/(protected)/create/page.tsx (Example)

import { fetchSocialAccounts } from "@/actions/server/supabase/fetchSocialAccounts";
import CreateTikTokPostForm from "@/components/core/create/CreateTikTokPostForm";

export default async function CreatePostPage() {
  // Fetch all social accounts on the server
  const allAccounts = await fetchSocialAccounts();

  // Filter for TikTok accounts to pass to the form
  const tiktokAccounts = allAccounts.filter((acc) => acc.platform === "tiktok");

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Créer une publication TikTok</h1>
      <CreateTikTokPostForm connectedAccounts={tiktokAccounts} />
    </div>
  );
}
