// actions/server/contentHistoryActions/storeContentHistory.ts
"use server";

import { adminSupabase } from "@/actions/api/supabase-client";

/**
 * Interface for content history data
 */
export interface ContentHistoryData {
  platform: string;
  contentId: string;
  title?: string | null;
  description?: string | null;
  mediaUrl?: string | null;
  extra?: Record<string, unknown> | null;
}

/**
 * Stores a record of posted content in the content_history table
 *
 * @param data ContentHistoryData object containing necessary information
 * @returns Object with success status, message, and optionally the record ID
 */
export async function storeContentHistory(
  data: ContentHistoryData,
  userId: string | null
): Promise<{ success: boolean; message: string; recordId?: string }> {
  // Basic validation
  if (!userId || !data.platform || !data.contentId) {
    return {
      success: false,
      message: "Missing required information (userId, platform, contentId)",
    };
  }

  try {
    console.log(
      `[storeContentHistory] Storing content history for user ${userId}`,
      {
        platform: data.platform,
        contentId: data.contentId,
      }
    );

    // Prepare data for insertion
    const insertData = {
      user_id: userId,
      platform: data.platform,
      content_id: data.contentId,
      title: data.title ?? null,
      description: data.description ?? null,
      media_url: data.mediaUrl ?? null,
      extra: data.extra ? JSON.stringify(data.extra) : null,
      created_at: new Date().toISOString(),
    };

    // Insert the record into the content_history table
    const { data: newRecord, error } = await adminSupabase
      .from("content_history")
      .insert(insertData)
      .select("id")
      .single();

    if (error) {
      console.error("[storeContentHistory] Supabase insert error:", error);
      return { success: false, message: `Database error: ${error.message}` };
    }

    console.log(
      `[storeContentHistory] Content history stored successfully with ID: ${newRecord.id}`
    );

    return {
      success: true,
      message: "Content history stored successfully",
      recordId: newRecord.id,
    };
  } catch (err) {
    console.error("[storeContentHistory] Unexpected error:", err);
    return {
      success: false,
      message:
        err instanceof Error ? err.message : "An unexpected error occurred",
    };
  }
}
