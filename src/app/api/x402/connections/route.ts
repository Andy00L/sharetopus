import "server-only";

import type { NextRequest } from "next/server";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/x402/connections
 *
 * Pays list_connections for $0.001 USDC. Reads connected social accounts.
 * Steps:
 * 1. Parse query params (include_unavailable).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Query social_accounts filtered by principal_id.
 * 4. Strip tokens and return safe projection.
 */

type ConnectionsParams = {
  includeUnavailable: boolean;
};

type ConnectionsResult = {
  accounts: Array<{
    id: string;
    platform: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    is_available: boolean;
    follower_count: number | null;
  }>;
};

export const GET = x402PaidEndpoint<ConnectionsParams, ConnectionsResult>({
  endpointPath: "/api/x402/connections",
  rateLimitScope: "x402:connections",
  rateLimitPerMinute: 60,

  parseBody: async (req: NextRequest) => {
    const url = new URL(req.url);
    const includeUnavailable = url.searchParams.get("include_unavailable") === "true";
    return { success: true, data: { includeUnavailable } };
  },

  resolveAction: () => ({ success: true, action: "list_connections" }),

  handler: async ({ body, principal }) => {
    // filterByAvailability=true means only available accounts shown.
    // When include_unavailable=true, we pass false to show all.
    const fetchResult = await fetchSocialAccounts(
      principal.principalId,
      "x402",
      !body.includeUnavailable,
    );

    if (!fetchResult.success) {
      return {
        success: false,
        errorKind: "query_failed",
        message: fetchResult.message,
        refundable: true,
      };
    }

    // Safe projection: strip tokens, refresh_tokens, and other sensitive fields.
    const safeAccounts = (fetchResult.data ?? []).map((account) => ({
      id: account.id,
      platform: account.platform,
      display_name: account.display_name,
      username: account.username,
      avatar_url: account.avatar_url,
      is_available: account.is_available,
      follower_count: account.follower_count,
    }));

    return {
      success: true,
      data: { accounts: safeAccounts },
    };
  },
});
