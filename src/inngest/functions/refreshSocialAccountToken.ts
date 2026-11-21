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
import { isAdapterPlatform } from "@/lib/platforms/capabilities";
import { refreshRegistryAccountToken } from "@/lib/platforms/providers/publishViaRegistry";
import type { TokenRefreshFailureReason } from "@/lib/platforms/providers/types";
import type { SocialAccount } from "@/lib/types/dbTypes";

import { inngest } from "../client";

type HorizonRefreshResult =
  | { ok: true; reconnectWarning: string | null }
  | { ok: false; message: string; reason: TokenRefreshFailureReason };

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

  const refreshResult = await refreshWithinHorizon(account);
  if (refreshResult.ok) {
    if (refreshResult.reconnectWarning === null) return { outcome: "refreshed" };
    console.warn(
      `[refreshAccountToken] ${account.platform} account ${account.id} needs a reconnect: ${refreshResult.reconnectWarning}`,
    );
    return { outcome: "needs_reconnect", message: refreshResult.reconnectWarning };
  }

  switch (refreshResult.reason) {
    case "auth_expired":
      console.warn(
        `[refreshAccountToken] ${account.platform} account ${account.id} needs a reconnect: ${refreshResult.message}`,
      );
      return { outcome: "needs_reconnect", message: refreshResult.message };
    case "transient":
      throw new Error(
        `[refreshAccountToken] ${account.platform} account ${account.id} refresh failed (${refreshResult.reason}): ${refreshResult.message}`,
      );
    default: {
      const unhandledReason: never = refreshResult.reason;
      throw new Error(`[refreshAccountToken] Unhandled failure reason: ${String(unhandledReason)}`);
    }
  }
}

async function refreshWithinHorizon(account: SocialAccount): Promise<HorizonRefreshResult> {
  const windowOptions = { refreshIfExpiringWithinMs: TOKEN_REFRESH_HORIZON_MS };
  if (isAdapterPlatform(account.platform)) {
    const tokenResult = await ensureValidToken(account, windowOptions);
    return tokenResult.success
      ? { ok: true, reconnectWarning: null }
      : { ok: false, message: tokenResult.error, reason: tokenResult.failureReason };
  }
  const tokenResult = await refreshRegistryAccountToken(account, windowOptions);
  return tokenResult.success
    ? { ok: true, reconnectWarning: tokenResult.reconnectWarning }
    : { ok: false, message: tokenResult.message, reason: tokenResult.reason };
}
