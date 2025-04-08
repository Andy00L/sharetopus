// app/(protected)/schedule/page.tsx
import { fetchSocialAccounts } from "@/actions/server/supabase/fetchSocialAccounts";
import SchedulePostForm from "@/components/core/scheduled/SchedulePostForm";
import { Button } from "@/components/ui/button";
import { SocialAccount } from "@/lib/types/socialAccount";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

export default async function SchedulePage() {
  // Get authenticated user
  const { userId } = await auth();
  // Fetch social accounts
  let socialAccounts: SocialAccount[] = [];
  let fetchError: string | null = null;

  try {
    // Fetch all connected social accounts
    console.log("[SchedulePage] Fetching social accounts...");
    socialAccounts = await fetchSocialAccounts(userId);
    console.log(`[SchedulePage] Fetched ${socialAccounts.length} accounts.`);
  } catch (error) {
    console.error("[SchedulePage] Error fetching accounts:", error);
    fetchError =
      error instanceof Error ? error.message : "Failed to load accounts.";
    socialAccounts = [];
  }

  // If no accounts are connected, show onboarding message
  if (socialAccounts.length === 0 && !fetchError) {
    return (
      <div className="container mx-auto py-8">
        <div className="max-w-2xl mx-auto text-center">
          <h1 className="text-2xl font-bold mb-4">
            No Social Accounts Connected
          </h1>
          <p className="text-muted-foreground mb-6">
            To schedule posts, you need to connect at least one social media
            account first.
          </p>
          <Button asChild>
            <Link href="/accounts">Connect Social Accounts</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Display error if fetch failed
  if (fetchError) {
    return (
      <div className="container mx-auto py-8 text-red-600">
        <div className="max-w-2xl mx-auto">
          <h1 className="text-2xl font-bold mb-4">Error Loading Accounts</h1>
          <p>Unable to load your social accounts: {fetchError}</p>
          <Button variant="outline" className="mt-4" asChild>
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Schedule a Social Media Post</h1>
      <div className="max-w-3xl mx-auto">
        <SchedulePostForm connectedAccounts={socialAccounts} userId={userId} />
      </div>
    </div>
  );
}
