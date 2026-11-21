import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { content_history, social_accounts } from "@/db/schema";
import type { CreatedVia, Platform } from "@/db/schema";
import type { ContentHistory } from "@/lib/types/dbTypes";
import { checkRateLimit } from "../rateLimit/checkRateLimit";
import { LIST_CONTENT_HISTORY_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";

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

  const rateLimitResult = await checkRateLimit({
    operation: rateLimitScope,
    identifier: principalId,
    rule: LIST_CONTENT_HISTORY_RATE_LIMIT,
  });

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

  return {
    success: true,
    message: contentHistoryRows.length
      ? `Retrieved ${contentHistoryRows.length} record(s).`
      : "No content history found.",
    data: contentHistoryRows,
  };
}
