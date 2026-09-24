"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { ensureValidToken } from "../../ensureValidToken";
import {
  getTikTokCreatorInfo,
  type CreatorInfoData,
} from "./getTikTokCreatorInfo";

type GetCreatorInfoForAccountResult =
  | { success: true; data: CreatorInfoData }
  | { success: false; message: string };

/**
 * Server Action wrapper: resolves a valid TikTok access token for the given
 * social_account (refreshes via ensureValidToken if expired, persists new
 * token to DB), then fetches creator info.
 *
 * Use this from client components instead of getTikTokCreatorInfo directly,
 * which takes a raw token and skips the refresh path.
 *
 * Tables touched: social_accounts (read + update on token refresh).
 * External calls: TikTok refresh endpoint (conditional), TikTok creator_info.
 */
export async function getTikTokCreatorInfoForAccount(
  socialAccountId: string,
): Promise<GetCreatorInfoForAccountResult> {
  // Public server action: require a session and account ownership, or any
  // client could probe creator info by account id.
  const { userId } = await auth();
  if (!userId) {
    return {
      success: false,
      message: "Authentication required. Please sign in again.",
    };
  }

  const { data: accountRows, error: accountError } = await runQuery(
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
  // A failed read is not a missing account: "not found or deleted" would
  // send the user off to reconnect an account that is still connected.
  if (accountError) {
    console.error(
      "[getTikTokCreatorInfoForAccount] Account fetch failed:",
      accountError.message,
    );
    return {
      success: false,
      message: "Could not load your TikTok account. Please try again.",
    };
  }

  const account = accountRows[0];
  if (!account) {
    console.error("[getTikTokCreatorInfoForAccount] Account not found");
    return {
      success: false,
      message: "TikTok account not found or deleted.",
    };
  }

  if (account.principal_id !== userId) {
    console.error(
      `[getTikTokCreatorInfoForAccount] Ownership mismatch for account ${socialAccountId}`,
    );
    return {
      success: false,
      message: "TikTok account not found or deleted.",
    };
  }

  if (account.platform !== "tiktok") {
    return {
      success: false,
      message: `Account platform is ${account.platform}, expected tiktok.`,
    };
  }

  const tokenResult = await ensureValidToken(account);

  if (!tokenResult.success || !tokenResult.token) {
    console.error(
      "[getTikTokCreatorInfoForAccount] Token resolution failed:",
      tokenResult.error,
    );
    return {
      success: false,
      message:
        tokenResult.error ??
        "Unable to refresh your TikTok connection. Please reconnect.",
    };
  }

  return getTikTokCreatorInfo(tokenResult.token);
}
