// actions/server/contentHistoryActions/getContentHistory.ts
import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type {
  ContentHistory,
  CreatedVia,
  Platform,
} from "@/lib/types/database.types";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches rows from `content_history` (newest first), with optional filters, using the
 * service-role Supabase client. Each {@link CreatedVia} value gets its own rate-limit bucket
 * so traffic from one channel does not exhaust another’s quota.
 *
 * **Authentication:** Does not call Clerk. The caller must pass a `principalId` they are
 * already allowed to read (e.g. session user id after `auth()` for the web UI, MCP principal id).
 *
 * **Rate limiting:** Before querying, {@link checkRateLimit} runs with
 * `operationName` set to `source` + `"_content_history"` (e.g. `web_content_history`,
 * `mcp_content_history`), the same `principalId`, and **60 requests per 60 seconds**.
 * On limit exceeded: `success: false`, a generic user message, and optional `resetIn`.
 *
 * **Data:** Reads `content_history` and joins `social_accounts` on `social_account_id` for `avatar_url`.
 *
 * **Known callers:** `renderPosts.tsx` (`source: "web"`), `listContentHistory.ts` (`source: "mcp"`).
 * Other `CreatedVia` values are typed for consistency; if used, they receive their own scope
 * (`x402_content_history`, `api_content_history`, etc.).
 *
 * @param principalId - Matches `content_history.principal_id`.
 * @param source - Channel label; used only to build the rate-limit `operationName` (see above).
 * @param filters - Optional `platform` filter and `limit` (ordered by `created_at` descending).
 * @returns On success, `data` is the row list; on rate limit or DB error, `success` is false.
 */
export async function getContentHistory(
  principalId: string,
  source: CreatedVia,
  filters?: { platform?: Platform; limit?: number },
): Promise<{
  success: boolean;
  message: string;
  data?: ContentHistory[];
  resetIn?: number;
}> {
  const rateLimitScope = `${source}_content_history`;

  // Step 2 — Throttle: max 60 hits / 60s per (scope, principalId) via Upstash (see checkRateLimit).
  const rateLimitResult = await checkRateLimit(
    rateLimitScope,
    principalId,
    60,
    60,
  );

  // Step 3 — Stop early if the bucket is exhausted; surface retry hint when available.
  if (!rateLimitResult.success) {
    console.error(
      `[getContentHistory] Rate limit exceeded: Source: ${source}, Principal ID: ${principalId}`,
      rateLimitResult.message,
    );
    return {
      success: false,
      message: `Too many requests. Try again in ${rateLimitResult.resetIn} seconds.`,
      resetIn: rateLimitResult.resetIn,
    };
  }

  // Step 4 — Base query: all columns + account avatar, scoped to this principal, newest first.
  let contentHistoryQuery = adminSupabase
    .from("content_history")
    .select(`*, social_accounts!social_account_id(avatar_url)`)
    .eq("principal_id", principalId)
    .order("created_at", { ascending: false });

  // Step 5 — Narrow to one platform when requested (enum-aligned with DB).
  if (filters?.platform) {
    contentHistoryQuery = contentHistoryQuery.eq("platform", filters.platform);
  }

  // Step 6 — Cap row count after sort (most recent N).
  if (filters?.limit) {
    contentHistoryQuery = contentHistoryQuery.limit(filters.limit);
  }

  // Step 7 — Execute and handle PostgREST errors without leaking internals to the client.
  const { data: contentHistoryRows, error: contentHistoryError } =
    await contentHistoryQuery;
  if (contentHistoryError) {
    console.error("[getContentHistory] DB error:", contentHistoryError.message);
    return { success: false, message: "Failed to fetch content history." };
  }

  // Step 8 — Success payload; empty list is still success with an explicit message.
  return {
    success: true,
    message: contentHistoryRows?.length
      ? `Retrieved ${contentHistoryRows.length} record(s).`
      : "No content history found.",
    data: contentHistoryRows as ContentHistory[],
  };
}
