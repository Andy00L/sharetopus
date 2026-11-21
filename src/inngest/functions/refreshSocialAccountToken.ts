import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import {
  socialAccountTokenRefreshEvent,
  TOKEN_REFRESH_HORIZON_MS,
} from "@/inngest/events/socialAccountTokenRefresh";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { isTokenExpiring } from "@/lib/api/refreshWithAccountLock";

import { inngest } from "../client";

export type TokenRefreshOutcome =
  | { outcome: "skipped"; reason: "account_gone" | "already_unavailable" }
  | { outcome: "not_due" }
  | { outcome: "refreshed" }
  | { outcome: "needs_reconnect"; message: string };

export const refreshSocialAccountToken = inngest.createFunction(
  {
    id: "refresh-social-account-token",
    name: "Refresh one social account's token",
    retries: 3,
    concurrency: { limit: 5 },
    triggers: [socialAccountTokenRefreshEvent],
  },
  ({ event, step }) =>
    step.run("refresh-token", () => refreshAccountToken(event.data.social_account_id)),
);

async function refreshAccountToken(socialAccountId: string): Promise<TokenRefreshOutcome> {
  const { data: accountRows, error } = await runQuery(
    db
      .select()
      .from(social_accounts)
      .where(and(eq(social_accounts.id, socialAccountId), isNull(social_accounts.deleted_at)))
      .limit(1),
  );
  // Inngest marks a step failed, and retries it, only when it throws:
  // https://www.inngest.com/docs/guides/error-handling
  if (error) {
    throw new Error(`[refreshAccountToken] Account read failed for ${socialAccountId}: ${error.message}`);
  }

  const account = accountRows[0];
  if (!account) return { outcome: "skipped", reason: "account_gone" };
  if (!account.is_available) return { outcome: "skipped", reason: "already_unavailable" };
  if (!isTokenExpiring(account.token_expires_at, TOKEN_REFRESH_HORIZON_MS)) {
    return { outcome: "not_due" };
  }

  const tokenResult = await ensureValidToken(account, {
    refreshIfExpiringWithinMs: TOKEN_REFRESH_HORIZON_MS,
  });
  if (tokenResult.success) return { outcome: "refreshed" };

  switch (tokenResult.failureReason) {
    case "auth_expired":
      console.warn(
        `[refreshAccountToken] ${account.platform} account ${account.id} needs a reconnect: ${tokenResult.error}`,
      );
      return { outcome: "needs_reconnect", message: tokenResult.error };
    case "transient":
      throw new Error(
        `[refreshAccountToken] ${account.platform} account ${account.id} refresh failed (${tokenResult.failureReason}): ${tokenResult.error}`,
      );
    default: {
      const unhandledReason: never = tokenResult.failureReason;
      throw new Error(`[refreshAccountToken] Unhandled failure reason: ${String(unhandledReason)}`);
    }
  }
}
