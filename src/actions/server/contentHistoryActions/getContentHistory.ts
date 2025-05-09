import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { ContentHistory } from "@/lib/types/dbTypes";

/**
 * Fetches content history for a user
 */
export async function getContentHistory(
  userId: string | null
): Promise<{ success: boolean; message: string; data?: ContentHistory[] }> {
  if (!userId) {
    return {
      success: false,
      message: "Missing required user ID",
    };
  }

  try {
    console.log(
      `[getContentHistory] Fetching content history for user ${userId}`
    );

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
      console.error("[getContentHistory] Supabase query error:", error);
      return { success: false, message: `Database error: ${error.message}` };
    }

    console.log(
      `[getContentHistory] Successfully fetched ${data.length} content history records`
    );

    return {
      success: true,
      message: "Content history fetched successfully",
      data: data as ContentHistory[],
    };
  } catch (err) {
    console.error("[getContentHistory] Unexpected error:", err);
    return {
      success: false,
      message: "An unexpected error occurred",
    };
  }
}

/**
 * Groups content history by batch_id for display
 */
export async function getContentHistoryGroupedByBatch(
  userId: string | null
): Promise<{
  success: boolean;
  message: string;
  data: Record<string, ContentHistory[]> | null;
}> {
  const result = await getContentHistory(userId);

  if (!result.success || !result.data) {
    return {
      success: result.success,
      message: result.message,
      data: null,
    };
  }

  // Group by batch_id
  const groupedByBatch = result.data.reduce((acc, item) => {
    if (!acc[item.batch_id]) {
      acc[item.batch_id] = [];
    }
    acc[item.batch_id].push(item);
    return acc;
  }, {} as Record<string, ContentHistory[]>);

  return {
    success: true,
    message: "Content history grouped by batch",
    data: groupedByBatch,
  };
}
