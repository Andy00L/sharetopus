import "server-only";

import type { Platform } from "@/lib/x402/connect/types";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { exchangeLinkedInForX402 } from "./linkedinTokenExchange";
import { exchangeTikTokForX402 } from "./tiktokTokenExchange";
import { exchangePinterestForX402 } from "./pinterestTokenExchange";
import { exchangeInstagramForX402 } from "./instagramTokenExchange";
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
  | { ok: true; connectionId: string; redirectUrl: string | null }
  | {
      ok: false;
      error:
        | { kind: "state_not_found"; message: string }
        | { kind: "state_expired"; message: string }
        | { kind: "state_already_used"; message: string }
        | { kind: "provider_error"; code: string; message: string }
        | { kind: "token_exchange_failed"; message: string }
        | { kind: "db_update_failed"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Shared callback handler for all 4 platforms.
 *
 * Flow:
 *   1. Look up social_connections WHERE oauth_state = $state
 *   2. If OAuth provider returned an error: update status to 'failed'
 *   3. Exchange code for token (per-platform wrapper)
 *   4. INSERT social_accounts row
 *   5. UPDATE social_connections SET status='connected', social_account_id
 *   6. Return success
 */
export async function handleOAuthCallback(
  input: OAuthCallbackInput
): Promise<OAuthCallbackResult> {
  // -- 1. Look up connection by oauth_state
  const { data: connection, error: lookupError } = await adminSupabase
    .from("social_connections")
    .select(
      "id, principal_id, platform, status, expires_at, metadata, redirect_uri"
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
    return {
      ok: false,
      error: {
        kind: "state_already_used",
        message: `Connection is already in status: ${connection.status}.`,
      },
    };
  }

  if (new Date(connection.expires_at) < new Date()) {
    // Mark as expired
    await adminSupabase
      .from("social_connections")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", connection.id);

    return {
      ok: false,
      error: {
        kind: "state_expired",
        message: "OAuth connection has expired.",
      },
    };
  }

  const redirectUrl = extractRedirectUrl(connection.metadata);

  // -- 2. Provider error (user denied consent)
  if (input.errorCode) {
    await adminSupabase
      .from("social_connections")
      .update({
        status: "failed",
        error_code: input.errorCode,
        error_message: input.errorDescription ?? input.errorCode,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return {
      ok: false,
      error: {
        kind: "provider_error",
        code: input.errorCode,
        message: input.errorDescription ?? "OAuth provider returned an error.",
      },
    };
  }

  // -- 3. Exchange code for token
  const exchangeResult = await dispatchTokenExchange(input.platform, input.code);
  if (!exchangeResult.ok) {
    await adminSupabase
      .from("social_connections")
      .update({
        status: "failed",
        error_code: exchangeResult.error,
        error_message: exchangeResult.message,
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return {
      ok: false,
      error: {
        kind: "token_exchange_failed",
        message: exchangeResult.message,
      },
    };
  }

  // -- 4. INSERT social_accounts row
  const tokenExpiresAt = new Date(
    Date.now() + exchangeResult.expiresIn * 1000
  ).toISOString();

  const { data: socialAccount, error: insertError } = await adminSupabase
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

  if (insertError || !socialAccount) {
    console.error(`[handleOAuthCallback] Failed to upsert social_accounts: ${insertError?.message}`);
    await adminSupabase
      .from("social_connections")
      .update({
        status: "failed",
        error_code: "db_upsert_failed",
        error_message: insertError?.message ?? "Failed to save account.",
        failed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    return {
      ok: false,
      error: {
        kind: "db_update_failed",
        message: "Failed to save social account.",
      },
    };
  }

  // -- 5. UPDATE social_connections
  const { error: updateError } = await adminSupabase
    .from("social_connections")
    .update({
      status: "connected",
      connected_at: new Date().toISOString(),
      social_account_id: socialAccount.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  if (updateError) {
    console.error(`[handleOAuthCallback] Failed to update social_connections: ${updateError.message}`);
    return {
      ok: false,
      error: {
        kind: "db_update_failed",
        message: "Failed to update connection status.",
      },
    };
  }

  // Dispatch connection.connected webhook after both DB ops succeed.
  dispatchWebhook(connection.principal_id, "connection.connected", {
    connection_id: connection.id,
    social_account_id: socialAccount.id,
    platform: input.platform,
  });

  return { ok: true, connectionId: connection.id, redirectUrl };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ExchangeSuccess {
  ok: true;
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
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
  code: string
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
  }
}

function extractRedirectUrl(metadata: unknown): string | null {
  if (metadata && typeof metadata === "object") {
    const m = metadata as Record<string, unknown>;
    if (typeof m.finalRedirectUrl === "string") return m.finalRedirectUrl;
  }
  return null;
}
