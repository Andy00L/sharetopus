// actions/server/contentHistoryActions/getContentHistory.ts
import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { content_history, social_accounts } from "@/db/schema";
import type { CreatedVia, Platform } from "@/db/schema";
import type { ContentHistory } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Fetches rows from `content_history` (newest first), with optional filters, through the
 * server-side Drizzle client. Each {@link CreatedVia} value gets its own rate-limit bucket
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
 * **Data:** Reads `content_history` and left-joins `social_accounts` on `social_account_id`
 * for `avatar_url`. Each row carries `social_accounts: { avatar_url } | null` (null when the
 * row has no account), the shape the history UI reads.
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

  // Step 2: Throttle: max 60 hits / 60s per (scope, principalId) via Upstash (see checkRateLimit).
  const rateLimitResult = await checkRateLimit(
    rateLimitScope,
    principalId,
    60,
    60,
  );

  // Step 3: Stop early if the bucket is exhausted; surface retry hint when available.
  if (!rateLimitResult.success) {
    console.error(
      `[getContentHistory] Rate limit exceeded: Source: ${source}, Principal ID: ${principalId}`,
      rateLimitResult.message,
    );
    return {
      success: false,
      message: rateLimitResult.message,
      resetIn: rateLimitResult.resetIn,
    };
  }

  // Step 4: Base query: all columns + account avatar, scoped to this principal, newest first.
  // Step 5: Narrow to one platform when requested (enum-aligned with DB).
  const contentHistoryQuery = db
    .select({
      history: content_history,
      account_id: social_accounts.id,
      account_avatar_url: social_accounts.avatar_url,
    })
    .from(content_history)
    .leftJoin(
      social_accounts,
      eq(social_accounts.id, content_history.social_account_id),
    )
    .where(
      and(
        eq(content_history.principal_id, principalId),
        filters?.platform
          ? eq(content_history.platform, filters.platform)
          : undefined,
      ),
    )
    .orderBy(desc(content_history.created_at))
    .$dynamic();

  // Step 6: Cap row count after sort (most recent N).
  // Step 7: Execute and handle database errors without leaking internals to the client.
  const { data: historyRows, error: contentHistoryError } = await runQuery(
    filters?.limit
      ? contentHistoryQuery.limit(filters.limit)
      : contentHistoryQuery,
  );
  if (contentHistoryError) {
    console.error("[getContentHistory] DB error:", contentHistoryError.message);
    return { success: false, message: "Failed to fetch content history." };
  }

  // The avatar is rebuilt by hand instead of selected as a nested object:
  // Drizzle nulls a nested object whose first column is null, so an account
  // without an avatar would lose its { avatar_url: null } entry.
  const contentHistoryRows = historyRows.map((row) => ({
    ...row.history,
    social_accounts:
      row.account_id === null ? null : { avatar_url: row.account_avatar_url },
  }));

  // Step 8: Success payload; empty list is still success with an explicit message.
  return {
    success: true,
    message: contentHistoryRows.length
      ? `Retrieved ${contentHistoryRows.length} record(s).`
      : "No content history found.",
    data: contentHistoryRows,
  };
}
