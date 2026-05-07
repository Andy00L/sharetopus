import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SchedulePostData } from "@/lib/types/SchedulePostData";
import type { Json } from "@/lib/types/database.types";

/**
 * Creates a scheduled post without authCheck. The MCP route has already
 * verified the principal.
 *
 * Mirrors the logic in src/actions/server/scheduleActions/schedulePost.ts
 * but skips Clerk auth. Rate limiting is handled by the MCP entitlement layer.
 *
 * Tables touched: scheduled_posts (insert), social_accounts (read for ownership check)
 * Called by: src/lib/mcp/tools/schedulePost.ts
 */
export async function schedulePostInternal(
  data: SchedulePostData,
  principalId: string
): Promise<{
  success: boolean;
  message: string;
  scheduleId?: string;
}> {
  try {
    if (
      !data ||
      !data.socialAccountId ||
      !data.platform ||
      !data.scheduledAt ||
      !data.postType
    ) {
      return {
        success: false,
        message:
          "Missing required post information. Provide socialAccountId, platform, scheduledAt, and postType.",
      };
    }

    if (data.postType !== "text" && !data.mediaStoragePath) {
      return {
        success: false,
        message: `Media file is required for ${data.postType} posts.`,
      };
    }

    // Verify social account ownership
    const { data: accountData, error: accountError } = await adminSupabase
      .from("social_accounts")
      .select("id")
      .eq("id", data.socialAccountId)
      .eq("principal_id", principalId)
      .single();

    if (accountError || !accountData) {
      return {
        success: false,
        message:
          "The selected social account is invalid or does not belong to you.",
      };
    }

    const scheduledDate = new Date(data.scheduledAt);
    const insertData = {
      principal_id: principalId,
      social_account_id: data.socialAccountId,
      platform: data.platform,
      status: "scheduled" as const,
      scheduled_at: scheduledDate.toISOString(),
      post_title: data.title ?? "",
      post_description: data.description,
      post_options: data.postOptions as Json,
      media_type: data.postType,
      media_storage_path: data.mediaStoragePath,
      cover_image_timestamp: data.coverTimestamp,
      batch_id: data.batch_id,
      created_via: "mcp" as const,
    };

    const { data: newSchedule, error } = await adminSupabase
      .from("scheduled_posts")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      return {
        success: false,
        message: `Failed to schedule post: ${error.message}`,
      };
    }

    if (!newSchedule?.id) {
      return {
        success: false,
        message: "Insert succeeded but no ID returned.",
      };
    }

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

    return {
      success: true,
      message: `${platformName} post scheduled for ${formattedDate}.`,
      scheduleId: newSchedule.id,
    };
  } catch (err) {
    console.error(
      `[schedulePostInternal] Unexpected error:`,
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message: "Unexpected error scheduling post.",
    };
  }
}
