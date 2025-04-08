// app/(protected)/scheduled/page.tsx
import { getScheduledPosts } from "@/actions/server/supabase/scheduleActions";
import ScheduledPostsList from "@/components/core/scheduled/ScheduledPostsList";
import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { auth } from "@clerk/nextjs/server";
import { RefreshCw } from "lucide-react";
import Link from "next/link";

// Define the type for scheduled posts
interface ScheduledPost {
  id: string;
  platform: string;
  status: "scheduled" | "processing" | "posted" | "failed" | "cancelled";
  scheduled_at: string;
  posted_at: string | null;
  post_title: string | null;
  post_options: Record<string, unknown> | null; // Using Record instead of 'any'
  media_type: string;
  media_storage_path: string;
  error_message: string | null;
  created_at: string;
  social_accounts: {
    id: string;
    platform: string;
    account_identifier: string;
    extra: {
      profile?: {
        display_name?: string;
        username?: string;
        avatar_url?: string;
      };
    } | null;
  };
}

export default async function ScheduledPostsPage() {
  let posts: ScheduledPost[] = [];
  let error: string | null = null;
  const { userId } = await auth();
  try {
    // Fetch scheduled posts
    posts = await getScheduledPosts(userId);
  } catch (err) {
    console.error("Error fetching scheduled posts:", err);
    error =
      err instanceof Error ? err.message : "Failed to load scheduled posts";
  }
  // If there's an error, render error state
  if (error) {
    return (
      <SidebarContent>
        <div className="container px-4 py-6">
          <SidebarGroup>
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 text-destructive">
              <div className="flex items-start gap-3">
                <RefreshCw className="h-5 w-5 mt-0.5 animate-spin" />
                <div>
                  <h3 className="font-medium mb-1">
                    Error loading scheduled posts
                  </h3>
                  <p className="text-sm">{error}</p>
                  <Button variant="outline" size="sm" className="mt-2" asChild>
                    <Link href="/scheduled">Try Again</Link>
                  </Button>
                </div>
              </div>
            </div>
          </SidebarGroup>
        </div>
      </SidebarContent>
    );
  }
  return <ScheduledPostsList posts={posts} userId={userId} />;
}
