"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SocialAccount } from "@/lib/types/dbTypes";
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
  const { data: account, error: accountError } = await adminSupabase
    .from("social_accounts")
    .select("*")
    .eq("id", socialAccountId)
    .is("deleted_at", null)
    .single();

  if (accountError || !account) {
    console.error(
      "[getTikTokCreatorInfoForAccount] Account fetch failed:",
      accountError?.message ?? "not found",
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

  const tokenResult = await ensureValidToken(account as SocialAccount);

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
