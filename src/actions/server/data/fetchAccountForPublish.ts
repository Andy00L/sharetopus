import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";

export type FetchAccountForPublishResult =
  | { success: true; account: SocialAccount }
  | {
      success: false;
      reason: "not_found" | "lookup_failed";
      message: string;
    };

export async function fetchAccountForPublish(
  socialAccountId: string,
): Promise<FetchAccountForPublishResult> {
  const { data: accountRows, error } = await runQuery(
    db
      .select()
      .from(social_accounts)
      .where(
        and(
          eq(social_accounts.id, socialAccountId),
          isNull(social_accounts.deleted_at),
        ),
      )
      .limit(1),
  );

  if (error) {
    console.error(
      `[fetchAccountForPublish] Account ${socialAccountId} lookup failed:`,
      error.message,
    );
    return {
      success: false,
      reason: "lookup_failed",
      message: `Failed to fetch account: ${error.message}`,
    };
  }

  const account = accountRows[0];
  if (!account) {
    return {
      success: false,
      reason: "not_found",
      message: "Social account not found or deleted",
    };
  }
  return { success: true, account };
}
