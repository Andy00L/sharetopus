"use server";

import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { createPinterestBoard } from "./createPinterestBoard";
import {
  getPinterestBoards,
  type PinterestBoard,
  type PinterestBoardsResponse,
} from "./getPinterestBoards";

/** createPinterestBoardForAccount calls per user per minute. */
const CREATE_BOARD_RATE_LIMIT = 10;
const CREATE_BOARD_RATE_WINDOW_SECONDS = 60;

type ResolvedPinterestAccount =
  | { success: true; accessToken: string; userId: string }
  | { success: false; message: string };

/**
 * Resolves a Pinterest access token for a board operation entirely
 * server-side: the caller identifies the account by id only. Validates the
 * Clerk session, checks the account belongs to the caller, then refreshes
 * the token if needed (ensureValidToken persists rotations). The token
 * never crosses to the client.
 *
 * Tables touched: social_accounts (read + update on token refresh).
 */
async function resolvePinterestAccessToken(
  socialAccountId: string,
): Promise<ResolvedPinterestAccount> {
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
  const account = accountRows?.[0];

  if (accountError || !account) {
    console.error(
      "[resolvePinterestAccessToken] Account fetch failed:",
      accountError?.message ?? "not found",
    );
    return { success: false, message: "Pinterest account not found." };
  }

  if (account.principal_id !== userId) {
    console.error(
      `[resolvePinterestAccessToken] Ownership mismatch for account ${socialAccountId}`,
    );
    return { success: false, message: "Pinterest account not found." };
  }

  if (account.platform !== "pinterest") {
    return {
      success: false,
      message: `Account platform is ${account.platform}, expected pinterest.`,
    };
  }

  const tokenResult = await ensureValidToken(account);
  if (!tokenResult.success || !tokenResult.token) {
    console.error(
      "[resolvePinterestAccessToken] Token resolution failed:",
      tokenResult.error,
    );
    return {
      success: false,
      message:
        tokenResult.error ??
        "Unable to refresh your Pinterest connection. Please reconnect.",
    };
  }

  return { success: true, accessToken: tokenResult.token, userId };
}

/**
 * Server Action: lists Pinterest boards for one of the caller's accounts.
 * Client components call this with an account id instead of a token.
 */
export async function getPinterestBoardsForAccount(
  socialAccountId: string,
  options?: { pageSize?: number; bookmark?: string },
): Promise<PinterestBoardsResponse> {
  const resolved = await resolvePinterestAccessToken(socialAccountId);
  if (!resolved.success) {
    return { boards: [], success: false };
  }
  return getPinterestBoards(resolved.accessToken, resolved.userId, options);
}

type CreateBoardForAccountResult =
  | { success: true; board: PinterestBoard }
  | { success: false; message: string };

/**
 * Server Action: creates a Pinterest board on one of the caller's
 * accounts. Rate limited per user; the token stays server-side.
 */
export async function createPinterestBoardForAccount(
  socialAccountId: string,
  name: string,
  description?: string,
): Promise<CreateBoardForAccountResult> {
  const resolved = await resolvePinterestAccessToken(socialAccountId);
  if (!resolved.success) {
    return { success: false, message: resolved.message };
  }

  const rateCheck = await checkRateLimit(
    "createPinterestBoard",
    resolved.userId,
    CREATE_BOARD_RATE_LIMIT,
    CREATE_BOARD_RATE_WINDOW_SECONDS,
  );
  if (!rateCheck.success) {
    return {
      success: false,
      message: "Too many board creations. Please try again shortly.",
    };
  }

  const board = await createPinterestBoard(
    resolved.accessToken,
    name,
    description,
  );
  if (!board) {
    return { success: false, message: "Failed to create board." };
  }
  return { success: true, board };
}
