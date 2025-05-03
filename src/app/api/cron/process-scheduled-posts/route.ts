// app/api/cron/process-scheduled-posts/route.ts
import { NextResponse } from "next/server";

import { adminSupabase } from "@/actions/api/supabase-client";
import { directPostForLinkedInAccounts } from "@/components/core/create/action/Direct/directPostForLinkedInAccounts";
import { directPostForPinterestAccounts } from "@/components/core/create/action/Direct/directPostForPinterestAccounts";
import { directPostForTikTokAccounts } from "@/components/core/create/action/Direct/directPostForTikTokAccounts";
import { ScheduledPost, SocialAccount } from "@/lib/types/dbTypes";

export async function GET(request: Request) {
  try {
    // Verify the request is coming from Vercel Cron
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Get posts that are due for publishing
    const now = new Date().toISOString();

    const { data: duePosts, error: fetchError } = await adminSupabase
      .from("scheduled_posts")
      .select(
        `
        *,
        social_accounts!inner(*)
      `
      )
      .lte("scheduled_at", now)
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(10); // Process 10 posts per execution to avoid timeouts

    if (fetchError) {
      console.error("[Cron] Error fetching due posts:", fetchError);
      return NextResponse.json(
        { error: "Failed to fetch posts" },
        { status: 500 }
      );
    }

    if (!duePosts || duePosts.length === 0) {
      console.log("[Cron] No posts to process");
      return NextResponse.json({ message: "No posts to process" });
    }

    console.log(`[Cron] Processing ${duePosts.length} scheduled posts`);

    const results = await Promise.allSettled(
      duePosts.map(
        async (post: ScheduledPost & { social_accounts: SocialAccount }) => {
          try {
            // Update status to processing
            await adminSupabase
              .from("scheduled_posts")
              .update({ status: "processing" })
              .eq("id", post.id);

            // Get the social account details
            const socialAccount = post.social_accounts;

            // Extract filename from media storage path
            const fileName = post.media_storage_path?.split("/").pop() || "";

            // Prepare the account content based on post data
            const accountContent = [
              {
                accountId: socialAccount.id,
                title: post.post_title || "",
                description: post.post_description || "",
                link: post.post_options?.pinterest?.link || "",
                isCustomized: false,
              },
            ];

            let result;

            // Call the appropriate direct posting function based on platform
            switch (post.platform.toLowerCase()) {
              case "pinterest":
                // Pinterest needs board information
                const boards = [
                  {
                    boardID: post.post_options?.pinterest?.board || "",
                    boardName: "", // Not available in scheduled post
                    accountId: socialAccount.id,
                    isSelected: true,
                  },
                ];

                result = await directPostForPinterestAccounts({
                  accounts: [socialAccount],
                  mediaPath: post.media_storage_path || "",
                  boards,
                  platformOptions: post.post_options || {},
                  accountContent,
                  userId: post.user_id || null,
                  cleanupFiles: false, // Don't cleanup as other posts might use same media
                  fileName,
                  batchId: post.batch_id || "",
                });
                break;

              case "tiktok":
                result = await directPostForTikTokAccounts({
                  accounts: [socialAccount],
                  mediaPath: post.media_storage_path || "",
                  platformOptions: post.post_options || {},
                  accountContent,
                  userId: post.user_id || null,
                  cleanupFiles: false,
                  fileName,
                  batchId: post.batch_id || "",
                });
                break;

              case "linkedin":
                result = await directPostForLinkedInAccounts({
                  accounts: [socialAccount],
                  mediaPath: post.media_storage_path || "",
                  platformOptions: post.post_options || {},
                  accountContent,
                  userId: post.user_id || null,
                  cleanupFiles: false,
                  fileName: fileName,
                  batchId: post.batch_id || "",
                });
                break;

              default:
                throw new Error(`Unsupported platform: ${post.platform}`);
            }

            // Update post status based on result
            if (result.success) {
              await adminSupabase
                .from("scheduled_posts")
                .update({
                  status: "posted",
                  posted_at: new Date().toISOString(),
                  error_message: null, // Clear any previous errors
                })
                .eq("id", post.id);

              console.log(
                `[Cron] Successfully posted to ${post.platform} for post ID: ${post.id}`
              );
            } else {
              await adminSupabase
                .from("scheduled_posts")
                .update({
                  status: "failed",
                  error_message:
                    result.message || "Unknown error occurred during posting",
                })
                .eq("id", post.id);

              console.error(
                `[Cron] Failed to post to ${post.platform} for post ID: ${post.id}`,
                result.message
              );
            }

            return {
              postId: post.id,
              success: result.success,
              platform: post.platform,
            };
          } catch (error) {
            console.error(`[Cron] Error processing post ${post.id}:`, error);

            // Update status to failed
            await adminSupabase
              .from("scheduled_posts")
              .update({
                status: "failed",
                error_message:
                  error instanceof Error
                    ? error.message
                    : "Unknown error occurred",
              })
              .eq("id", post.id);

            return {
              postId: post.id,
              success: false,
              platform: post.platform,
              error,
            };
          }
        }
      )
    );

    // Count successes and failures
    const successCount = results.filter(
      (r) => r.status === "fulfilled" && r.value.success
    ).length;
    const failureCount = results.filter(
      (r) =>
        r.status === "rejected" ||
        (r.status === "fulfilled" && !r.value.success)
    ).length;

    // Log platform-specific results for monitoring
    const platformResults = results.reduce((acc, result) => {
      if (result.status === "fulfilled") {
        const platform = result.value.platform;
        if (!acc[platform]) {
          acc[platform] = { success: 0, failed: 0 };
        }
        if (result.value.success) {
          acc[platform].success++;
        } else {
          acc[platform].failed++;
        }
      }
      return acc;
    }, {} as Record<string, { success: number; failed: number }>);

    console.log(
      "[Cron] Processing complete. Results by platform:",
      platformResults
    );

    return NextResponse.json({
      message: `Processed ${duePosts.length} posts`,
      success: successCount,
      failed: failureCount,
      platformBreakdown: platformResults,
    });
  } catch (error) {
    console.error("[Cron] Job error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
