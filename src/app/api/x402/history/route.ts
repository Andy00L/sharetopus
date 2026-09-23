import "server-only";

import type { NextRequest } from "next/server";

import { x402PaidEndpoint } from "@/lib/x402/middleware/x402PaidEndpoint";
import { getContentHistory } from "@/actions/server/contentHistoryActions/getContentHistory";
import {
  isSchedulablePlatform,
  type SchedulablePlatform,
} from "@/lib/platforms/capabilities";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/x402/history
 *
 * Pays the list_history action (price per pricing_actions). Reads content
 * history for the wallet.
 * Steps:
 * 1. Parse query params (platform, limit).
 * 2. x402 middleware handles payment and the charge.
 * 3. Query content_history filtered by principal_id.
 */

/** Page size bounds for ?limit. */
const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

type HistoryParams = {
  platform: SchedulablePlatform | undefined;
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

export const GET = x402PaidEndpoint<HistoryParams, HistoryResult>({
  endpointPath: "/api/x402/history",
  rateLimitScope: "x402:history",
  rateLimitPerMinute: 60,
  defaultAction: "list_history",

  parseBody: async (req: NextRequest) => {
    const url = new URL(req.url);
    const platformParam = url.searchParams.get("platform");
    const limitParam = url.searchParams.get("limit");

    let platform: SchedulablePlatform | undefined;
    if (platformParam) {
      // The platform registry is the one list of platform values
      // (src/lib/platforms/capabilities.ts), not a copy kept here.
      if (!isSchedulablePlatform(platformParam)) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_platform",
          message: `Invalid platform "${platformParam}".`,
        };
      }
      platform = platformParam;
    }

    let limit = DEFAULT_HISTORY_LIMIT;
    if (limitParam) {
      const parsedLimit = parseInt(limitParam, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_HISTORY_LIMIT) {
        return {
          success: false,
          httpStatus: 400,
          errorKind: "invalid_limit",
          message: `limit must be between 1 and ${MAX_HISTORY_LIMIT}.`,
        };
      }
      limit = parsedLimit;
    }

    return { success: true, data: { platform, limit } };
  },

  resolveAction: () => ({ success: true, action: "list_history" }),

  handler: async ({ body, principal }) => {
    const result = await getContentHistory(principal.principalId, "x402", {
      platform: body.platform,
      limit: body.limit,
    });

    if (!result.success) {
      return {
        success: false,
        errorKind: "query_failed",
        message: result.message,
        refundable: true,
      };
    }

    // Safe projection: only the fields an agent needs.
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

    return { success: true, data: { history } };
  },
});
