import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { after } from "next/server";

import type { Platform } from "@/lib/x402/connect/types";
import { db, runQuery } from "@/db/client";
import { social_accounts, social_connections } from "@/db/schema";
import { checkShareLinkOwnerCapacity } from "@/actions/server/share-link/checkShareLinkOwnerCapacity";
import {
  validateShareLinkById,
  type ShareLinkRefusal,
} from "@/actions/server/share-link/validateShareToken";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { exchangeLinkedInForX402 } from "./linkedinTokenExchange";
import { exchangeTikTokForX402 } from "./tiktokTokenExchange";
import { exchangePinterestForX402 } from "./pinterestTokenExchange";
import { exchangeInstagramForX402 } from "./instagramTokenExchange";
import { exchangeYouTubeForX402 } from "./youtubeTokenExchange";
import { exchangeXForX402 } from "./xTokenExchange";
import { exchangeFacebookForX402 } from "./facebookTokenExchange";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OAuthCallbackInput {
  platform: Platform;
  code: string;
  state: string;
  errorCode: string | null;
  errorDescription: string | null;
}

export type OAuthCallbackResult =
  | {
      ok: true;
      connectionId: string;
      shareLinkId?: string | null;
      initiatedVia?: string;
      accountUsername?: string;
    }
  | {
      ok: false;
      error:
        | { kind: "state_not_found"; message: string }
        | { kind: "state_expired"; message: string }
        | { kind: "state_already_used"; message: string }
        | { kind: "platform_mismatch"; message: string }
        | { kind: "provider_error"; code: string; message: string }
        | { kind: "token_exchange_failed"; message: string }
        | { kind: "db_update_failed"; message: string }
        | { kind: "share_link_not_found"; message: string }
        | { kind: "share_link_revoked"; message: string }
        | { kind: "share_link_expired"; message: string }
        | { kind: "share_link_max_uses_reached"; message: string }
        | { kind: "owner_account_limit_reached"; message: string }
        | { kind: "owner_subscription_inactive"; message: string }
        | { kind: "temporarily_unavailable"; message: string };
    };

export type CallbackErrorKind = Extract<
  OAuthCallbackResult,
  { ok: false }
>["error"]["kind"];

/**
 * A database read failed before the code was exchanged. Nothing is used up:
 * the connection stays pending and the code is still valid, so reloading the
 * callback page retries.
 */
const TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Could not finish connecting right now. Refresh this page to try again.";

/** The callback error for each reason a share link cannot be used. */
const SHARE_LINK_REFUSAL_KINDS = {
  invalid_format: "share_link_not_found",
  not_found: "share_link_not_found",
  revoked: "share_link_revoked",
  expired: "share_link_expired",
  max_uses_reached: "share_link_max_uses_reached",
  lookup_failed: "temporarily_unavailable",
} as const satisfies Record<ShareLinkRefusal, CallbackErrorKind>;

/**
 * Reasons the consume_share_link function returns. It lives only in the
 * database (sourceRef: pg_get_functiondef of public.consume_share_link,
 * read 2026-09-24; docs/DATABASE.md lists it).
 */
const CONSUME_REFUSAL_REASONS = [
  "not_found",
  "revoked",
  "expired",
  "max_uses_reached",
] as const satisfies readonly ShareLinkRefusal[];

function isConsumeRefusalReason(
  reason: unknown,
): reason is (typeof CONSUME_REFUSAL_REASONS)[number] {
  return CONSUME_REFUSAL_REASONS.some((knownReason) => knownReason === reason);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Shared callback handler for all 7 platforms, serving both x402-initiated
 * and REST-initiated connections (owner resolved from social_connections by
 * oauth_state; no session cookie involved).
 *
 * Flow:
 *   1. Look up social_connections WHERE oauth_state = $state (must be pending)
 *   2. Share-link flows: re-validate link + owner plan and limits before any
 *      exchange. A failed database read in steps 1-2 answers
 *      temporarily_unavailable and leaves the connection pending: the code
 *      is not spent yet, so reloading the page retries.
 *   3. If the OAuth provider returned an error: transition to 'failed'
 *   4. Exchange code for token (per-platform wrapper)
 *   5. Share-link flows: consume_share_link RPC (atomic used_count)
 *   6. UPSERT social_accounts row
 *   7. Transition pending -> connected (status-scoped; a concurrent duplicate
 *      callback loses this transition and reports state_already_used)
 *
 * Concurrency: the pending check in step 1 is advisory; correctness comes
 * from every status transition being scoped to the expected prior status,
 * so a duplicate delivery of the same callback can never overwrite a
 * winner's 'connected' with 'failed'.
 *
 * Tables touched: social_connections, social_accounts, share_links (via RPC)
 */
export async function handleOAuthCallback(
  input: OAuthCallbackInput
): Promise<OAuthCallbackResult> {
  // -- 1. Look up connection by oauth_state. oauth_code_verifier carries
  //       the PKCE verifier for platforms that mandate it (X).
  const { data: connectionRows, error: lookupError } = await runQuery(
    db
      .select({
        id: social_connections.id,
        principal_id: social_connections.principal_id,
        platform: social_connections.platform,
        status: social_connections.status,
        expires_at: social_connections.expires_at,
        share_link_id: social_connections.share_link_id,
        initiated_via: social_connections.initiated_via,
        oauth_code_verifier: social_connections.oauth_code_verifier,
      })
      .from(social_connections)
      .where(eq(social_connections.oauth_state, input.state))
      .limit(1)
  );

  if (lookupError) {
    console.error(`[handleOAuthCallback] DB error looking up state: ${lookupError.message}`);
    return {
      ok: false,
      error: {
        kind: "temporarily_unavailable",
        message: TEMPORARILY_UNAVAILABLE_MESSAGE,
      },
    };
  }

  const connection = connectionRows[0];
  if (!connection) {
    return {
      ok: false,
      error: {
        kind: "state_not_found",
        message: "OAuth state not found. It may have expired or been used.",
      },
    };
  }

  if (connection.status !== "pending") {
    // Generic on purpose: this page renders to whoever holds the state
    // string, and the internal status value is none of their business.
    return {
      ok: false,
      error: {
        kind: "state_already_used",
        message: "This connection link was already used.",
      },
    };
  }

  if (new Date(connection.expires_at) < new Date()) {
    await transitionPendingTo(connection.id, {
      status: "expired",
    });

    return {
      ok: false,
      error: {
        kind: "state_expired",
        message: "OAuth connection has expired.",
      },
    };
  }

  // The callback path names the platform whose code is about to be
  // exchanged; it must be the platform this connection was created and paid
  // for. The connection is left pending, so its own callback still works.
  if (connection.platform !== input.platform) {
    return {
      ok: false,
      error: {
        kind: "platform_mismatch",
        message: "This connection link belongs to a different platform.",
      },
    };
  }

  // -- 2. Share link steps: validate share link, owner tier, owner account
  //    limits. These run BEFORE token exchange so we abort early if the link
  //    was revoked/expired between the friend clicking "Connect" and the
  //    callback.
  const shareLinkId = connection.share_link_id;

  if (shareLinkId !== null) {
    const shareLinkValidation = await validateShareLinkById(shareLinkId);
    if (!shareLinkValidation.success) {
      const errorKind = SHARE_LINK_REFUSAL_KINDS[shareLinkValidation.reason];
      if (errorKind === "temporarily_unavailable") {
        return {
          ok: false,
          error: { kind: errorKind, message: TEMPORARILY_UNAVAILABLE_MESSAGE },
        };
      }

      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: errorKind,
        error_message: `Share link validation failed: ${shareLinkValidation.reason}`,
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return {
        ok: false,
        error: {
          kind: errorKind,
          message: `Share link is no longer valid: ${shareLinkValidation.reason}.`,
        },
      };
    }

    // Owner plan + account limit check
    const ownerCapacity = await checkShareLinkOwnerCapacity(
      connection.principal_id,
    );
    if (!ownerCapacity.ok) {
      if (ownerCapacity.reason === "owner_check_failed") {
        return {
          ok: false,
          error: {
            kind: "temporarily_unavailable",
            message: TEMPORARILY_UNAVAILABLE_MESSAGE,
          },
        };
      }

      const ownerRefusalMessage =
        ownerCapacity.reason === "owner_subscription_inactive"
          ? "The link owner's subscription is not active. The connection cannot be completed."
          : "The link owner has reached their account limit. The connection cannot be completed.";

      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: ownerCapacity.reason,
        error_message: ownerRefusalMessage,
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return {
        ok: false,
        error: { kind: ownerCapacity.reason, message: ownerRefusalMessage },
      };
    }
  }

  // -- 3. Provider error (user denied consent)
  if (input.errorCode) {
    await transitionPendingTo(connection.id, {
      status: "failed",
      error_code: input.errorCode,
      error_message: input.errorDescription ?? input.errorCode,
    });

    return {
      ok: false,
      error: {
        kind: "provider_error",
        code: input.errorCode,
        message: input.errorDescription ?? "OAuth provider returned an error.",
      },
    };
  }

  // -- 4. Exchange code for token
  const exchangeResult = await dispatchTokenExchange(
    input.platform,
    input.code,
    connection.oauth_code_verifier,
  );
  if (!exchangeResult.ok) {
    await transitionPendingTo(connection.id, {
      status: "failed",
      error_code: exchangeResult.error,
      error_message: exchangeResult.message,
    });

    return {
      ok: false,
      error: {
        kind: "token_exchange_failed",
        message: exchangeResult.message,
      },
    };
  }

  // -- 5. Share link: consume_share_link RPC (atomic used_count increment).
  //    Called AFTER token exchange succeeds so a failed exchange never burns
  //    a use. Called BEFORE social_accounts upsert so we don't create an
  //    account if the link was fully consumed by a concurrent request.
  if (shareLinkId !== null) {
    const { data: consumeRows, error: consumeError } = await runQuery(
      db.execute(sql`select * from public.consume_share_link(${shareLinkId}::uuid)`),
    );

    // One (success boolean, reason text) row; any other shape is a failure.
    const consumeResult = consumeRows?.[0];
    const consumeReason = consumeResult?.reason;

    // The code is spent by now, so every failure here ends the attempt.
    if (consumeError) {
      console.error(
        `[handleOAuthCallback] consume_share_link failed: ${consumeError.message}`,
      );
      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: "db_update_failed",
        error_message: "Could not record the share link use.",
      });
      logShareLinkAudit(input.platform, "share_link.use_failed", "error");
      return {
        ok: false,
        error: {
          kind: "db_update_failed",
          message: "Could not record the share link use. Please open the link again.",
        },
      };
    }

    if (consumeResult?.success !== true) {
      // An unknown reason reads as not_found, as it always has.
      const refusal = isConsumeRefusalReason(consumeReason)
        ? consumeReason
        : "not_found";
      const errorKind = SHARE_LINK_REFUSAL_KINDS[refusal];
      console.error(
        `[handleOAuthCallback] consume_share_link refused: ${refusal}`,
      );

      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: errorKind,
        error_message: `Share link consumption failed: ${refusal}`,
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return {
        ok: false,
        error: {
          kind: errorKind,
          message: `Share link could not be used: ${refusal}.`,
        },
      };
    }
  }

  // -- 6. UPSERT social_accounts row. A null expiresIn means the token
  //       never expires (Facebook Page tokens); the row stores null.
  const tokenExpiresAt =
    exchangeResult.expiresIn === null
      ? null
      : new Date(Date.now() + exchangeResult.expiresIn * 1000).toISOString();

  const socialAccountValues = {
    principal_id: connection.principal_id,
    platform: input.platform,
    account_identifier: exchangeResult.accountIdentifier,
    is_available: true,
    display_name: exchangeResult.profile.name ?? null,
    username: exchangeResult.profile.username ?? exchangeResult.profile.name ?? null,
    avatar_url: exchangeResult.profile.avatarUrl ?? null,
    access_token: exchangeResult.accessToken,
    refresh_token: exchangeResult.refreshToken,
    token_expires_at: tokenExpiresAt,
    connection_id: connection.id,
    updated_at: new Date().toISOString(),
  };
  const { data: upsertedAccounts, error: upsertError } = await runQuery(
    db
      .insert(social_accounts)
      .values(socialAccountValues)
      .onConflictDoUpdate({
        target: [
          social_accounts.principal_id,
          social_accounts.platform,
          social_accounts.account_identifier,
        ],
        set: socialAccountValues,
      })
      .returning({ id: social_accounts.id })
  );

  const socialAccount = upsertedAccounts?.[0];
  if (upsertError || !socialAccount) {
    console.error(`[handleOAuthCallback] Failed to upsert social_accounts: ${upsertError?.message}`);
    await transitionPendingTo(connection.id, {
      status: "failed",
      error_code: "db_upsert_failed",
      error_message: upsertError?.message ?? "Failed to save account.",
    });

    return {
      ok: false,
      error: {
        kind: "db_update_failed",
        message: "Failed to save social account.",
      },
    };
  }

  // -- 7. Transition pending -> connected (status-scoped)
  const { data: connectedRows, error: connectError } = await runQuery(
    db
      .update(social_connections)
      .set({
        status: "connected",
        connected_at: new Date().toISOString(),
        social_account_id: socialAccount.id,
        updated_at: new Date().toISOString(),
      })
      .where(and(eq(social_connections.id, connection.id), eq(social_connections.status, "pending")))
      .returning({ id: social_connections.id })
  );

  if (connectError) {
    console.error(`[handleOAuthCallback] Failed to update social_connections: ${connectError.message}`);
    // Compensating transition: the tokens are already stored on the
    // social_accounts row, but a connection stuck in 'pending' would keep
    // polling agents waiting until cron expiry. Mark it failed so the state
    // is at least terminal; the account row stays for manual reconciliation.
    await transitionPendingTo(connection.id, {
      status: "failed",
      error_code: "db_update_failed",
      error_message: connectError.message,
    });
    return {
      ok: false,
      error: {
        kind: "db_update_failed",
        message: "Failed to update connection status.",
      },
    };
  }

  if (connectedRows.length === 0) {
    // A concurrent duplicate callback won the transition; this delivery is
    // the loser and must not double-fire the webhook.
    return {
      ok: false,
      error: {
        kind: "state_already_used",
        message: "This connection link was already used.",
      },
    };
  }

  if (shareLinkId !== null) {
    logShareLinkAudit(input.platform, "share_link.use_succeeded", "ok");
  }

  // The webhook runs after the response: a slow subscriber must not block
  // the callback page, and after() keeps the serverless function alive until
  // the dispatch finishes instead of dropping a floating promise.
  const connectedWebhookPayload = {
    connection_id: connection.id,
    social_account_id: socialAccount.id,
    platform: input.platform,
    initiated_via: connection.initiated_via,
    share_link_id: shareLinkId,
  };
  after(() =>
    dispatchWebhook(connection.principal_id, "connection.connected", connectedWebhookPayload),
  );

  // Derive the username for the success page redirect
  const accountUsername =
    exchangeResult.profile.username ?? exchangeResult.profile.name ?? null;

  return {
    ok: true,
    connectionId: connection.id,
    shareLinkId,
    initiatedVia: connection.initiated_via,
    accountUsername: accountUsername ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Status-scoped transition out of 'pending'. Scoping to the prior status is
 * what makes duplicate concurrent callbacks safe: the loser's transition
 * matches zero rows instead of overwriting the winner's outcome. Errors are
 * logged but not propagated; every caller is already on a failure path (or
 * lazily expiring) where the user-facing error matters more than the
 * bookkeeping write.
 */
async function transitionPendingTo(
  connectionId: string,
  fields: {
    status: "expired" | "failed";
    error_code?: string;
    error_message?: string;
  }
): Promise<void> {
  const updateFields: {
    status: "expired" | "failed";
    updated_at: string;
    failed_at?: string;
    error_code?: string;
    error_message?: string;
  } = {
    status: fields.status,
    updated_at: new Date().toISOString(),
  };
  if (fields.status === "failed") {
    updateFields.failed_at = new Date().toISOString();
  }
  if (fields.error_code !== undefined) {
    updateFields.error_code = fields.error_code;
  }
  if (fields.error_message !== undefined) {
    updateFields.error_message = fields.error_message;
  }

  const { error } = await runQuery(
    db
      .update(social_connections)
      .set(updateFields)
      .where(and(eq(social_connections.id, connectionId), eq(social_connections.status, "pending")))
  );

  if (error) {
    console.error(
      `[handleOAuthCallback] Transition to ${fields.status} failed for connection ${connectionId}: ${error.message}`
    );
  }
}

/**
 * Share-link audit entry. Fire-and-forget per the audit logger's contract;
 * the action strings are seeded in pricing_actions as audit-only rows.
 */
function logShareLinkAudit(
  platform: Platform,
  action: "share_link.use_failed" | "share_link.use_succeeded",
  resultStatus: "ok" | "error"
): void {
  after(() =>
    logX402Call({
      principal: null,
      action,
      endpoint: `/api/oauth/callback/${platform}`,
      chargeId: null,
      resultStatus,
    }),
  );
}

interface ExchangeSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  /** Seconds until expiry; null means the token never expires (Facebook). */
  expiresIn: number | null;
  accountIdentifier: string;
  profile: {
    name?: string;
    username?: string;
    avatarUrl?: string;
  };
}

type ExchangeFailure = {
  ok: false;
  error: string;
  message: string;
};

/**
 * Exchanges the code with the platform and normalizes the profile. LinkedIn
 * and TikTok expose no handle, so the display name stands in for username;
 * the upsert above applies the same fallback either way.
 */
async function dispatchTokenExchange(
  platform: Platform,
  code: string,
  codeVerifier: string | null
): Promise<ExchangeSuccess | ExchangeFailure> {
  const result = await runPlatformExchange(platform, code, codeVerifier);
  if (!result.ok) return result;

  const profile = result.profile;
  return {
    ok: true,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    expiresIn: result.expiresIn,
    accountIdentifier: result.accountIdentifier,
    profile: {
      name: profile.name,
      username: ("username" in profile ? profile.username : undefined) ?? profile.name,
      avatarUrl: profile.avatarUrl,
    },
  };
}

/** The per-platform exchange for this callback. */
function runPlatformExchange(platform: Platform, code: string, codeVerifier: string | null) {
  switch (platform) {
    case "linkedin":
      return exchangeLinkedInForX402(code);
    case "tiktok":
      return exchangeTikTokForX402(code);
    case "pinterest":
      return exchangePinterestForX402(code);
    case "instagram":
      return exchangeInstagramForX402(code);
    case "youtube":
      return exchangeYouTubeForX402(code);
    case "x":
      return exchangeXForX402(code, codeVerifier);
    case "facebook":
      return exchangeFacebookForX402(code);
  }
}
