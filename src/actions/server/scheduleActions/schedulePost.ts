"use server";

import { adminSupabase } from "@/actions/api/supabase-client";
import { SchedulePostData } from "@/lib/types/SchedulePostData";

/**
 * Schedule a post for publishing at a later time
 *
 * @param data SchedulePostData object containing necessary information for scheduling
 * @returns Object with success status, message, and optionally the scheduled post ID
 */
export async function schedulePost(
  data: SchedulePostData,
  userId: string | null
): Promise<{ success: boolean; message: string; scheduleId?: string }> {
  if (!userId) {
    return { success: false, message: "User not authenticated." };
  }

  // Basic validation - common fields for all post types
  if (
    !data.socialAccountId ||
    !data.platform ||
    !data.scheduledAt ||
    !data.mediaType
  ) {
    return {
      success: false,
      message: "Missing required scheduling information.",
    };
  }

  // Media-specific validation - only check mediaStoragePath for media posts
  if (data.mediaType !== "text" && !data.mediaStoragePath) {
    return {
      success: false,
      message: "Media path is required for image and video posts.",
    };
  }

  try {
    console.log(`[schedulePost] Scheduling post for user ${userId}`, data);

    // Validate the social account belongs to this user
    const { data: accountData, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("id", data.socialAccountId)
      .eq("user_id", userId)
      .single();

    if (accountError || !accountData) {
      console.error("[schedulePost] Account validation error:", accountError);
      return {
        success: false,
        message:
          "The selected social account is invalid or doesn't belong to you.",
      };
    }

    // Prepare data for insertion
    const insertData = {
      user_id: userId,
      social_account_id: data.socialAccountId,
      platform: data.platform,
      status: "scheduled", // Default status
      scheduled_at: new Date(data.scheduledAt).toISOString(), // Ensure it's ISO string
      post_title: data.title ?? "",
      post_description: data.description,
      post_options: data.postOptions, // Store the JSONB options
      media_type: data.mediaType,
      media_storage_path: data.mediaStoragePath,
    };

    // Insert the record into the scheduled_posts table
    const { data: newSchedule, error } = await adminSupabase
      .from("scheduled_posts")
      .insert(insertData)
      .select("id") // Select the ID of the newly created row
      .single(); // Expect only one row back

    if (error) {
      console.error("[schedulePost] Supabase insert error:", error);
      return { success: false, message: `Database error: ${error.message}` };
    }

    if (!newSchedule?.id) {
      console.error("[schedulePost] Insert succeeded but no ID returned.");
      return {
        success: false,
        message: "Failed to confirm schedule creation.",
      };
    }

    console.log(
      `[schedulePost] Post scheduled successfully with ID: ${newSchedule.id}`
    );

    // Add platform-specific success messages
    let platformMessage = "";
    if (data.platform === "tiktok") {
      platformMessage =
        " Your TikTok video will be published at the scheduled time.";
    } else if (data.platform === "instagram") {
      platformMessage =
        " Your Instagram post will be published at the scheduled time.";
    } else if (data.platform === "facebook") {
      platformMessage =
        " Your Facebook post will be published at the scheduled time.";
    }

    return {
      success: true,
      message: `Post scheduled successfully!${platformMessage}`,
      scheduleId: newSchedule.id,
    };
  } catch (err) {
    console.error("[schedulePost] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred.",
    };
  }
}
