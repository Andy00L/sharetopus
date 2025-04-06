// src/app/(protected)/create/page.tsx (Example Path)

import { fetchSocialAccounts } from "@/actions/server/supabase/fetchSocialAccounts";
import CreateTikTokPostForm from "@/components/core/create/CreateTikTokPostForm";
import { SocialAccount } from "@/lib/types/socialAccount"; // Ensure this type import is correct

export default async function CreatePostPage() {
  let tiktokAccounts: SocialAccount[] = []; // Initialize as empty array
  let fetchError: string | null = null;

  try {
    // Fetch all social accounts on the server
    console.log("[CreatePostPage] Fetching social accounts...");
    const allAccounts = await fetchSocialAccounts();
    console.log(`[CreatePostPage] Fetched ${allAccounts.length} accounts.`);

    // Filter for TikTok accounts to pass to the form
    tiktokAccounts = allAccounts.filter((acc) => acc.platform === "tiktok");
    console.log(
      `[CreatePostPage] Found ${tiktokAccounts.length} TikTok accounts.`
    );
  } catch (error) {
    console.error("[CreatePostPage] Error fetching accounts:", error);
    // Set an error message to potentially display to the user
    fetchError =
      error instanceof Error ? error.message : "Failed to load accounts.";
    // Ensure tiktokAccounts remains empty if fetch fails
    tiktokAccounts = [];
  }

  // Basic error display if fetch failed (optional)
  if (fetchError) {
    return (
      <div className="container mx-auto py-8 text-red-600">
        Erreur lors du chargement des comptes : {fetchError}
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Créer une publication TikTok</h1>
      {/* Pass the potentially empty array */}
      <CreateTikTokPostForm connectedAccounts={tiktokAccounts} />
    </div>
  );
}
