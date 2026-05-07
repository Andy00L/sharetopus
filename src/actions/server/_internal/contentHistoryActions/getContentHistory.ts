import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { ContentHistory } from "@/lib/types/dbTypes";

/**
 * Fetches content history for a principal without authCheck.
 *
 * Mirrors src/actions/server/contentHistoryActions/getContentHistory.ts.
 * Skips Clerk auth and rate limiting.
 *
 * Tables read: content_history, social_accounts (join for avatar_url)
 * Called by: src/lib/mcp/tools/listContentHistory.ts, src/lib/mcp/resources/contentHistory.ts
 */
export async function getContentHistoryInternal(
  principalId: string,
  filters?: {
    platform?: string;
    limit?: number;
  }
): Promise<{
  success: boolean;
  message: string;
  data?: ContentHistory[];
}> {
  try {
    let query = adminSupabase
      .from("content_history")
      .select(
        `
        *,
        social_accounts!social_account_id(avatar_url)
      `
      )
      .eq("principal_id", principalId)
      .order("created_at", { ascending: false });

    if (filters?.platform) {
      query = query.eq("platform", filters.platform);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      return {
        success: false,
        message: `Failed to fetch content history: ${error.message}`,
      };
    }

    return {
      success: true,
      message:
        data && data.length > 0
          ? `Retrieved ${data.length} history record(s).`
          : "No content history found.",
      data: data as ContentHistory[],
    };
  } catch (err) {
    console.error(
      `[getContentHistoryInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error fetching content history." };
  }
}
