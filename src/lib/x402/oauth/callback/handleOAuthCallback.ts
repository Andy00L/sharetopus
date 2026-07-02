import "server-only";

import type { Platform } from "@/lib/x402/connect/types";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";
import { validateShareLinkById } from "@/actions/server/share-link/validateShareToken";
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
        | { kind: "provider_error"; code: string; message: string }
        | { kind: "token_exchange_failed"; message: string }
        | { kind: "db_update_failed"; message: string }
        | { kind: "share_link_not_found"; message: string }
        | { kind: "share_link_revoked"; message: string }
        | { kind: "share_link_expired"; message: string }
        | { kind: "share_link_max_uses_reached"; message: string }
        | { kind: "owner_account_limit_reached"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Shared callback handler for all 4 platforms, serving both x402-initiated
 * and REST-initiated connections (owner resolved from social_connections by
 * oauth_state; no session cookie involved).
 *
 * Flow:
 *   1. Look up social_connections WHERE oauth_state = $state (must be pending)
 *   2. Share-link flows: re-validate link + owner limits before any exchange
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
  const { data: connection, error: lookupError } = await adminSupabase
    .from("social_connections")
    .select(
      "id, principal_id, platform, status, expires_at, share_link_id, initiated_via, oauth_code_verifier"
    )
    .eq("oauth_state", input.state)
    .maybeSingle();

  if (lookupError) {
    console.error(`[handleOAuthCallback] DB error looking up state: ${lookupError.message}`);
    return {
      ok: false,
      error: {
        kind: "state_not_found",
        message: "Failed to look up OAuth state.",
      },
    };
  }

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

  // -- 2. Share link steps: validate share link, owner tier, owner account
  //    limits. These run BEFORE token exchange so we abort early if the link
  //    was revoked/expired between the friend clicking "Connect" and the
  //    callback.
  const shareLinkId = connection.share_link_id;

  if (shareLinkId !== null) {
    const shareLinkValidation = await validateShareLinkById(shareLinkId);
    if (!shareLinkValidation.success) {
      const reasonToKind: Record<string, string> = {
        not_found: "share_link_not_found",
        revoked: "share_link_revoked",
        expired: "share_link_expired",
        max_uses_reached: "share_link_max_uses_reached",
      };
      const errorKind =
        reasonToKind[shareLinkValidation.reason] ?? "share_link_not_found";

      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: errorKind,
        error_message: `Share link validation failed: ${shareLinkValidation.reason}`,
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return {
        ok: false,
        error: {
          kind: errorKind as "share_link_not_found",
          message: `Share link is no longer valid: ${shareLinkValidation.reason}.`,
        },
      };
    }

    // Owner tier lookup + account limit check
    const ownerSubscription = await checkActiveSubscription(
      connection.principal_id,
    );
    const ownerLimits = await checkAccountLimits(
      connection.principal_id,
      ownerSubscription.tier,
    );
    if (!ownerLimits.success || !ownerLimits.canAddMore) {
      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: "owner_account_limit_reached",
        error_message: "Owner has reached their account limit.",
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return {
        ok: false,
        error: {
          kind: "owner_account_limit_reached",
          message:
            "The link owner has reached their account limit. The connection cannot be completed.",
        },
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
    const { data: consumeRows, error: consumeError } = await adminSupabase.rpc(
      "consume_share_link",
      { p_share_link_id: shareLinkId },
    );

    const consumeResult =
      consumeRows && consumeRows.length > 0 ? consumeRows[0] : null;

    if (consumeError || !consumeResult || !consumeResult.success) {
      const reason = consumeResult?.reason ?? consumeError?.message ?? "unknown";
      console.error(
        `[handleOAuthCallback] consume_share_link failed: ${reason}`,
      );

      await transitionPendingTo(connection.id, {
        status: "failed",
        error_code: `share_link_${reason}`,
        error_message: `Share link consumption failed: ${reason}`,
      });

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      // Map RPC reason to the appropriate error kind
      const reasonKindMap: Record<string, string> = {
        not_found: "share_link_not_found",
        revoked: "share_link_revoked",
        expired: "share_link_expired",
        max_uses_reached: "share_link_max_uses_reached",
      };
      const errorKind = reasonKindMap[reason] ?? "share_link_not_found";

      return {
        ok: false,
        error: {
          kind: errorKind as "share_link_not_found",
          message: `Share link could not be used: ${reason}.`,
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

  const { data: socialAccount, error: upsertError } = await adminSupabase
    .from("social_accounts")
    .upsert(
      {
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
      },
      { onConflict: "principal_id, platform, account_identifier" }
    )
    .select("id")
    .single();

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
  const { data: connectedRows, error: connectError } = await adminSupabase
    .from("social_connections")
    .update({
      status: "connected",
      connected_at: new Date().toISOString(),
      social_account_id: socialAccount.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id)
    .eq("status", "pending")
    .select("id");

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

  if (!connectedRows || connectedRows.length === 0) {
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

  // Webhook dispatch is fire-and-forget by design: delivery retries are the
  // webhook system's job and a slow subscriber must not block the callback.
  void dispatchWebhook(connection.principal_id, "connection.connected", {
    connection_id: connection.id,
    social_account_id: socialAccount.id,
    platform: input.platform,
    initiated_via: connection.initiated_via,
    share_link_id: shareLinkId,
  });

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

  const { error } = await adminSupabase
    .from("social_connections")
    .update(updateFields)
    .eq("id", connectionId)
    .eq("status", "pending");

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
  void logX402Call({
    principal: null,
    action,
    endpoint: `/api/oauth/callback/${platform}`,
    chargeId: null,
    resultStatus,
  });
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

async function dispatchTokenExchange(
  platform: Platform,
  code: string,
  codeVerifier: string | null
): Promise<ExchangeSuccess | ExchangeFailure> {
  switch (platform) {
    case "linkedin": {
      const result = await exchangeLinkedInForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.name,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "tiktok": {
      const result = await exchangeTikTokForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.name,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "pinterest": {
      const result = await exchangePinterestForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.username,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "instagram": {
      const result = await exchangeInstagramForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.username,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "youtube": {
      const result = await exchangeYouTubeForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.username,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "x": {
      const result = await exchangeXForX402(code, codeVerifier);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.username,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
    case "facebook": {
      const result = await exchangeFacebookForX402(code);
      if (!result.ok) return result;
      return {
        ok: true,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresIn: result.expiresIn,
        accountIdentifier: result.accountIdentifier,
        profile: {
          name: result.profile.name,
          username: result.profile.username,
          avatarUrl: result.profile.avatarUrl,
        },
      };
    }
  }
}
