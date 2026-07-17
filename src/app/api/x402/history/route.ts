import "server-only";

import type { NextRequest } from "next/server";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { getContentHistory } from "@/actions/server/contentHistoryActions/getContentHistory";
import type { Platform } from "@/lib/types/database.types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * GET /api/x402/history
 *
 * Pays list_history for $0.001 USDC. Reads content history for the wallet.
 * Steps:
 * 1. Parse query params (platform, limit).
 * 2. x402 middleware handles auth, payment, charge.
 * 3. Query content_history filtered by principal_id.
 * 4. Return history list.
 */

type HistoryParams = {
  platform: Platform | undefined;
  limit: number;
};

type HistoryResult = {
  history: Array<{
    id: string;
    platform: string;
    content_id: string;
    title: string | null;
    description: string | null;
    media_url: string | null;
    media_type: string | null;
    status: string | null;
    created_via: string;
    created_at: string;
  }>;
};

const VALID_PLATFORMS: Platform[] = [
  "linkedin", "tiktok", "pinterest", "instagram",
  "facebook", "threads", "youtube", "x",
];

export const GET = x402PaidEndpoint<HistoryParams, HistoryResult>({
  endpointPath: "/api/x402/history",
  rateLimitScope: "x402:history",
  rateLimitPerMinute: 60,
  defaultAction: "list_history",

  parseBody: async (req: NextRequest) => {
    const url = new URL(req.url);
    const platformParam = url.searchParams.get("platform");
    const limitParam = url.searchParams.get("limit");

    let platform: Platform | undefined;
    if (platformParam) {
      if (!VALID_PLATFORMS.includes(platformParam as Platform)) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_platform",
          message: `Invalid platform "${platformParam}". Must be one of: ${VALID_PLATFORMS.join(", ")}.`,
        };
      }
      platform = platformParam as Platform;
    }

    let limit = 20;
    if (limitParam) {
      const parsed = parseInt(limitParam, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_limit",
          message: "limit must be between 1 and 100.",
        };
      }
      limit = parsed;
    }

    return { success: true, data: { platform, limit } };
  },

  resolveAction: () => ({ success: true, action: "list_history" }),

  handler: async ({ body, principal }) => {
    const result = await getContentHistory(
      principal.principalId,
      "x402",
      {
        platform: body.platform,
        limit: body.limit,
      },
    );

    if (!result.success) {
      return {
        success: false,
        errorKind: "query_failed",
        message: result.message,
        refundable: true,
      };
    }

    // Project fields. content_history has no tokens to strip.
    const history = (result.data ?? []).map((entry) => ({
      id: entry.id,
      platform: entry.platform,
      content_id: entry.content_id,
      title: entry.title,
      description: entry.description,
      media_url: entry.media_url,
      media_type: entry.media_type,
      status: entry.status,
      created_via: entry.created_via,
      created_at: entry.created_at,
    }));

    return {
      success: true,
      data: { history },
    };
  },
});
