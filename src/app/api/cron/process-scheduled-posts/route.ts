// app/api/cron/process-batch/route.ts
import { NextRequest, NextResponse } from "next/server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { storeFailedPost } from "@/actions/server/contentHistoryActions/storeFailedPost";
import { deleteScheduledPostBatch } from "@/actions/server/scheduleActions/deleteScheduledPost";
import {
  BoardInfo,
  ContentInfo,
  handleSocialMediaPost,
} from "@/components/core/create/action/handleSocialMediaPost";
import { PlatformOptions, SocialAccount } from "@/lib/types/dbTypes";

export async function POST(request: NextRequest) {
  console.log("[BATCH] Processing request started");

  try {
    // 1. Authenticate the request
    const authHeader = request.headers.get("Authorization");
    if (authHeader !== `Bearer ${process.env.CRON_SECRET_KEY}`) {
      console.error("[BATCH] Unauthorized request attempt");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse the request body
    const { batch_id, user_id, secret } = await request.json();

    if (secret !== process.env.CRON_SECRET_KEY) {
      console.error("[BATCH] Invalid secret in request body");
      return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
    }

    if (!batch_id || !user_id) {
      console.error("[BATCH] Missing required parameters");
      return NextResponse.json(
        {
          error: "Missing batch_id or user_id",
        },
        { status: 400 }
      );
    }

    console.log(`[BATCH] Processing batch ${batch_id} for user ${user_id}`);

    // 3. Get posts for this batch
    const { data: postsData, error: postsError } = await adminSupabase
      .from("scheduled_posts")
      .select("*")
      .eq("batch_id", batch_id);

    if (postsError) {
      console.error(`[BATCH] Error fetching posts: ${postsError.message}`);
      return NextResponse.json(
        {
          error: postsError.message,
          batch_id,
        },
        { status: 500 }
      );
    }

    if (!postsData || postsData.length === 0) {
      console.warn(`[BATCH] No posts found for batch ${batch_id}`);
      return NextResponse.json({
        message: "No posts found for this batch",
        batch_id,
      });
    }

    console.log(`[BATCH] Found ${postsData.length} posts to process`);

    // 4. Get all social accounts needed for this batch
    const accountIds = [
      ...new Set(postsData.map((post) => post.social_account_id)),
    ];
    const { data: accountsData, error: accountsError } = await adminSupabase
      .from("social_accounts")
      .select("*")
      .in("id", accountIds);

    if (accountsError || !accountsData) {
      console.error(
        `[BATCH] Error fetching accounts: ${accountsError?.message}`
      );

      // Reset posts back to scheduled if we can't fetch accounts
      await adminSupabase
        .from("scheduled_posts")
        .update({
          status: "scheduled",
          error_message: "Failed to fetch account data",
          updated_at: new Date().toISOString(),
        })
        .eq("batch_id", batch_id);

      return NextResponse.json(
        {
          error: accountsError?.message || "Failed to fetch accounts",
          batch_id,
        },
        { status: 500 }
      );
    }

    // 5. Organize data for handleSocialMediaPost

    // Group accounts by platform
    const pinterestAccounts: SocialAccount[] = [];
    const linkedinAccounts: SocialAccount[] = [];
    const tiktokAccounts: SocialAccount[] = [];

    accountsData.forEach((account) => {
      if (account.platform === "pinterest") pinterestAccounts.push(account);
      else if (account.platform === "linkedin") linkedinAccounts.push(account);
      else if (account.platform === "tiktok") tiktokAccounts.push(account);
    });

    // Extract media path from first post (all posts in batch share same media)
    const mediaPost = postsData.find((post) => post.media_storage_path);
    const mediaPath = mediaPost?.media_storage_path || "";

    const fileName = mediaPath ? mediaPath.split("/").pop() || "" : "";
    const postType = (mediaPost?.media_type || "text") as
      | "image"
      | "video"
      | "text";

    const coverImagePost = postsData.find((post) => post.cover_storage_path);
    const coverImagePath = coverImagePost?.cover_storage_path || "";

    // Prepare boards and content
    const boards: BoardInfo[] = [];
    const accountContent: ContentInfo[] = [];

    for (const post of postsData) {
      try {
        const options = post.post_options || {};
        // Add content
        accountContent.push({
          accountId: post.social_account_id,
          title: post.post_title || "",
          description: post.post_description || "",
          link: options.link || "",
          isCustomized: true,
        });

        // Add board if it's Pinterest
        if (post.platform === "pinterest" && options.board) {
          boards.push({
            boardID: options.board,
            boardName: options.boardName || "Board",
            accountId: post.social_account_id,
            isSelected: true,
          });
        }
      } catch (e) {
        console.warn(
          `[BATCH] Error parsing post options for post ${post.id}: ${e}`
        );
      }
    }

    // Prepare platform options
    const platformOptions: PlatformOptions = {
      pinterest: {
        privacyLevel: "PUBLIC", // Default value
        board: "", // Will be overridden by specific posts
        link: "", // Will be overridden by specific posts
      },
      linkedin: {
        visibility: "PUBLIC", // Default value
      },
      tiktok: {
        privacyLevel: "PUBLIC_TO_EVERYONE", // Default value
        disableComment: false, // Default value
        disableDuet: false, // Default value
        disableStitch: false, // Default value
      },
    };
    // Add platform-specific options if needed
    // Then override with specific options from posts
    postsData.forEach((post) => {
      try {
        const options = post.post_options || {};
        if (post.platform === "pinterest") {
          if (options.privacyLevel)
            platformOptions.pinterest!.privacyLevel = options.privacyLevel;
          if (options.link) platformOptions.pinterest!.link = options.link;
          // Board is handled separately in the boards array
        } else if (post.platform === "linkedin") {
          if (options.visibility)
            platformOptions.linkedin!.visibility = options.visibility;
        } else if (post.platform === "tiktok") {
          if (options.privacyLevel)
            platformOptions.tiktok!.privacyLevel = options.privacyLevel;
          if (options.disableComment !== undefined)
            platformOptions.tiktok!.disableComment = options.disableComment;
          if (options.disableDuet !== undefined)
            platformOptions.tiktok!.disableDuet = options.disableDuet;
          if (options.disableStitch !== undefined)
            platformOptions.tiktok!.disableStitch = options.disableStitch;
        }
      } catch (e) {
        console.warn(`[BATCH] Error parsing platform options: ${e}`);
      }
    });

    // 6. Process the batch using handleSocialMediaPost
    console.log(
      `[BATCH] Executing handleSocialMediaPost for batch ${batch_id}`
    );

    const config = {
      pinterestAccounts,
      linkedinAccounts,
      tiktokAccounts,
      mediaPath,
      coverImagePath,
      fileName,
      boards,
      platformOptions,
      accountContent,
      isScheduled: false, // We're executing now, so it's a direct post
      postType,
      userId: user_id,
      batchId: batch_id,
      cleanupFiles: false, // Don't delete the files after posting
      isCronJob: true,
    };

    const result = await handleSocialMediaPost(config);
    console.log(`[BATCH] Processing result:`, {
      success: result.success,
      counts: result.counts,
      errors: result.errors?.length,
    });

    // 7. Delete processed posts from scheduled_posts table
    console.log(`[BATCH] Deleting processed posts for batch ${batch_id}`);

    try {
      // Get all post IDs from this batch
      const postIds = postsData.map((post) => post.id);

      if (postIds.length > 0) {
        // Use the deleteScheduledPostBatch function to handle the deletion
        // We're passing the user_id from the request
        const deleteResult = await deleteScheduledPostBatch(
          postIds,
          user_id,
          true
        );

        if (!deleteResult.success) {
          console.warn(
            `[BATCH] Warning: Error cleaning up scheduled posts: ${deleteResult.message}`
          );
          // Continue anyway - the posts were processed successfully
        } else {
          console.log(
            `[BATCH] Successfully deleted ${
              deleteResult.details?.succeeded ?? 0
            } posts from scheduled_posts`
          );
        }
      }
    } catch (deleteError) {
      console.error(
        `[BATCH] Error during deletion of processed posts:`,
        deleteError
      );
      // Continue since this is just cleanup and the main process succeeded
    }

    // 8. Return success
    return NextResponse.json({
      success: true,
      batch_id,
      processed: postsData.length,
      result: {
        success: result.success,
        counts: result.counts,
        errors: result.errors?.length ?? 0,
      },
    });
  } catch (error) {
    console.error("[BATCH] Unexpected error:", error);

    // Try to store in failed_posts and delete from scheduled_posts if we have batch_id
    try {
      const { batch_id, user_id } = await request.json();
      if (batch_id && user_id) {
        // 1. Get the posts for this batch
        const { data: postsData } = await adminSupabase
          .from("scheduled_posts")
          .select("*")
          .eq("batch_id", batch_id);

        if (postsData && postsData.length > 0) {
          // 2. Store each post as a failed post
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          for (const post of postsData) {
            await storeFailedPost({
              user_id,
              social_account_id: post.social_account_id,
              platform: post.platform,
              post_title: post.post_title,
              post_description: post.post_description,
              post_options: post.post_options,
              media_type: post.media_type,
              media_storage_path: post.media_storage_path ?? "",
              batch_id,
              scheduled_at: post.scheduled_at,
              extra_data: { message: errorMessage },
            });
          }

          // 3. Delete all posts from scheduled_posts
          const postIds = postsData.map((post) => post.id);
          await deleteScheduledPostBatch(postIds, user_id, true);

          console.log(
            `[BATCH] Stored ${postsData.length} failed posts and deleted from scheduled_posts`
          );
        }
      }
    } catch (fallbackError) {
      console.error("[BATCH] Error in fallback error handling:", fallbackError);
      // Continue to return the original error
    }

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
