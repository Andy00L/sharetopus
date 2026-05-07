import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SocialAccount } from "@/lib/types/dbTypes";

/**
 * Fetches social accounts for a principal without authCheck.
 *
 * Mirrors src/actions/server/data/fetchSocialAccounts.ts.
 * Skips Clerk auth and rate limiting (handled by MCP entitlement layer).
 *
 * Tables read: social_accounts
 * Called by: src/lib/mcp/tools/listConnections.ts, src/lib/mcp/resources/connections.ts
 */
export async function fetchSocialAccountsInternal(
  principalId: string,
  filterByAvailability: boolean = true
): Promise<{
  success: boolean;
  message: string;
  data?: SocialAccount[];
}> {
  try {
    let query = adminSupabase
      .from("social_accounts")
      .select("*")
      .eq("principal_id", principalId);

    if (filterByAvailability) {
      query = query.eq("is_available", true);
    }

    const { data, error } = await query;

    if (error) {
      return {
        success: false,
        message: `Failed to retrieve social accounts: ${error.message}`,
      };
    }

    return {
      success: true,
      message:
        data && data.length > 0
          ? `Retrieved ${data.length} social account(s).`
          : "No social accounts found.",
      data: (data ?? []) as SocialAccount[],
    };
  } catch (err) {
    console.error(
      `[fetchSocialAccountsInternal] Error:`,
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error fetching social accounts." };
  }
}
