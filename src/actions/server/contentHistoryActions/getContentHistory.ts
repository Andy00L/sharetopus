import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { ContentHistory } from "@/lib/types/dbTypes";
import { authCheck } from "../authCheck";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches content history for the authenticated user
 *
 * @param userId - ID of the user whose content history to fetch
 * @returns Structured response with success status and optional content history data
 */
export async function getContentHistory(userId: string | null): Promise<{
  success: boolean;
  message: string;
  data?: ContentHistory[];
  resetIn?: number;
}> {
  try {
    // Verify authentication
    const authResult = await authCheck(userId);
    if (!authResult) {
      console.error(`[getContentHistory] Auth failed for user: ${userId}`);
      return {
        success: false,
        message: "Authentication validation failed. Please sign in again.",
      };
    }

    // Check rate limits
    const rateCheck = await checkRateLimit("getContentHistory", userId, 60, 60);
    if (!rateCheck.success) {
      console.warn(
        `[getContentHistory] Rate limit exceeded for user: ${userId}`
      );
      return {
        success: false,
        message: "Too many requests. Please try again later.",
        resetIn: rateCheck.resetIn,
      };
    }

    const { data, error } = await adminSupabase
      .from("content_history")
      .select(
        `
        *,
        social_accounts!social_account_id(avatar_url)
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[getContentHistory] Database error:", error.message);
      return {
        success: false,
        message: "Failed to fetch content history. Please try again later.",
      };
    }

    console.log(
      `[getContentHistory] Fetched ${
        data?.length || 0
      } records for user: ${userId}`
    );

    return {
      success: true,
      message:
        data && data.length > 0
          ? "Content history fetched successfully"
          : "No content history found",
      data: data as ContentHistory[],
    };
  } catch (error) {
    console.error(
      "[getContentHistory] Unexpected error:",
      error instanceof Error ? error.message : error
    );
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
}

/**
 * Groups content history by batch_id for display
 *
 * Note: This function reuses getContentHistory(), so rate limiting is inherited.
 *
 * @param userId - ID of the user whose content history to group
 * @returns Structured response with grouped content history
 */
export async function getContentHistoryGroupedByBatch(
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  data?: Record<string, ContentHistory[]>;
  resetIn?: number;
}> {
  const result = await getContentHistory(userId);

  if (!result.success || !result.data) {
    return {
      success: result.success,
      message: result.message,
      resetIn: result.resetIn,
    };
  }

  // Group by batch_id, handling null/undefined batch IDs
  const groupedByBatch = result.data.reduce((acc, item) => {
    if (!acc[item.batch_id]) {
      acc[item.batch_id] = [];
    }
    acc[item.batch_id].push(item);
    return acc;
  }, {} as Record<string, ContentHistory[]>);

  const batchCount = Object.keys(groupedByBatch).length;
  console.log(
    `[getContentHistoryGroupedByBatch] Grouped into ${batchCount} batches for user: ${userId}`
  );

  return {
    success: true,
    message: `Content history grouped into ${batchCount} batches`,
    data: groupedByBatch,
  };
}
