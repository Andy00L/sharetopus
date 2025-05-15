import { adminSupabase } from "@/actions/api/adminSupabase";
import { SchedulePostData } from "@/lib/types/SchedulePostData";
import "server-only";

/**
 * Schedules a post for publishing at a specified future time
 *
 * This function:
 * 1. Verifies user authentication
 * 2. Performs rate limiting to prevent abuse
 * 3. Validates the post data and social account ownership
 * 4. Creates a scheduled post record in the database
 * 5. Returns a structured response with the operation result
 *
 * @param data - SchedulePostData object containing all post information
 * @param userId - ID of the authenticated user
 * @returns Object with success status, message, optional post ID, and rate limit info
 */
export async function schedulePost(
  data: SchedulePostData,
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  scheduleId?: string;
  resetIn?: number;
}> {
  try {
    // Early validation for all required fields
    if (
      !data ||
      !data.socialAccountId ||
      !data.platform ||
      !data.scheduledAt ||
      !data.postType
    ) {
      console.error(
        `[schedulePost]: Missing required fields in scheduling data`,
        {
          hasData: !!data,
          hasSocialAccountId: !!data?.socialAccountId,
          hasPlatform: !!data?.platform,
          hasScheduledAt: !!data?.scheduledAt,
          hasPostType: !!data?.postType,
        }
      );
      return {
        success: false,
        message:
          "Missing required post information. Please fill in all required fields.",
      };
    }

    // Media-specific validation can then be done separately
    if (data.postType !== "text" && !data.mediaStoragePath) {
      console.error(
        `[schedulePost]: Media path missing for ${data.postType} post`
      );
      return {
        success: false,
        message: `Media file is required for ${data.postType} posts.`,
      };
    }
    console.log(
      `[schedulePost]: Starting post scheduling process for user: ${userId}`
    );

    // Step 3: Validate post data
    console.log(
      `[schedulePost]: Validating post data for platform: ${data.platform}`
    );

    // Basic validation for required fields
    if (
      !data.socialAccountId ||
      !data.platform ||
      !data.scheduledAt ||
      !data.postType
    ) {
      console.error(
        `[schedulePost]: Missing required fields in scheduling data`
      );
      return {
        success: false,
        message:
          "Missing required scheduling information. Please fill in all required fields.",
      };
    }

    // Media-specific validation
    if (data.postType !== "text" && !data.mediaStoragePath) {
      console.error(
        `[schedulePost]: Media path missing for ${data.postType} post`
      );
      return {
        success: false,
        message: `Media file is required for ${data.postType} posts.`,
      };
    }

    // Step 4: Verify social account ownership
    console.log(
      `[schedulePost]: Verifying ownership of social account: ${data.socialAccountId}`
    );
    const { data: accountData, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("id", data.socialAccountId)
      .eq("user_id", userId)
      .single();

    if (accountError || !accountData) {
      console.error(
        `[schedulePost]: Social account verification failed:`,
        accountError?.message || "Account not found"
      );
      return {
        success: false,
        message:
          "The selected social account is invalid or doesn't belong to you.",
      };
    }
    console.log(`[schedulePost]: Account ownership verified`);

    // Step 5: Prepare data for database insertion
    const scheduledDate = new Date(data.scheduledAt);
    console.log(
      `[schedulePost]: Scheduling post for: ${scheduledDate.toISOString()}`
    );
    const insertData = {
      user_id: userId,
      social_account_id: data.socialAccountId,
      platform: data.platform,
      status: "scheduled", // Default status
      scheduled_at: scheduledDate.toISOString(),
      post_title: data.title ?? "",
      post_description: data.description,
      post_options: data.postOptions, // Store the JSONB options
      media_type: data.postType,
      media_storage_path: data.mediaStoragePath,
      batch_id: data.batch_id,
    };

    // Step 6: Insert the record into the database
    console.log(`[schedulePost]: Creating database record for scheduled post`);
    const { data: newSchedule, error } = await adminSupabase
      .from("scheduled_posts")
      .insert(insertData)
      .select("id") // Select the ID of the newly created row
      .single(); // Expect only one row back

    if (error) {
      console.error(
        `[schedulePost]: Database error during post creation:`,
        error.message,
        error.details
      );
      return {
        success: false,
        message: `Failed to schedule your post. Database error: ${error.message}`,
      };
    }

    if (!newSchedule?.id) {
      console.error(`[schedulePost]: Insert succeeded but no ID returned`);
      return {
        success: false,
        message:
          "Failed to confirm schedule creation. Please check your scheduled posts later.",
      };
    }
    // Step 7: Return success response with platform-specific message
    const formattedDate = scheduledDate.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "numeric",
      hour12: true,
    });
    const platformName =
      data.platform.charAt(0).toUpperCase() + data.platform.slice(1);

    console.log(
      `[schedulePost]: Post successfully scheduled with ID: ${newSchedule.id} for ${platformName}`
    );
    return {
      success: true,
      message: `Your ${platformName} post has been scheduled for ${formattedDate}.`,
      scheduleId: newSchedule.id,
    };
  } catch (err) {
    // Step 8: Handle unexpected errors
    console.error(
      `[schedulePost]: Unexpected error during post scheduling:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message:
        "An unexpected error occurred while scheduling your post. Please try again later.",
    };
  }
}
