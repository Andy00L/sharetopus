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
import { runWriteWithOneRetry } from "@/lib/x402/db/runWriteWithOneRetry";
import {
  buildSocialAccountValues,
  connectPlatformAccounts,
} from "@/lib/api/oauth/connectPlatformAccounts";
import { dispatchWebhook } from "@/lib/api/rest/webhooks/dispatch";

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

type CallbackError = Extract<OAuthCallbackResult, { ok: false }>["error"];

export type CallbackErrorKind = CallbackError["kind"];

type PendingConnectionTransition = {
  status: "expired" | "failed";
  error_code?: string;
  error_message?: string;
};

const TEMPORARILY_UNAVAILABLE_MESSAGE =
  "Could not finish connecting right now. Refresh this page to try again.";

const SHARE_LINK_REFUSAL_KINDS = {
  invalid_format: "share_link_not_found",
  not_found: "share_link_not_found",
  revoked: "share_link_revoked",
  expired: "share_link_expired",
  max_uses_reached: "share_link_max_uses_reached",
  lookup_failed: "temporarily_unavailable",
} as const satisfies Record<ShareLinkRefusal, CallbackErrorKind>;

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

export async function handleOAuthCallback(
  input: OAuthCallbackInput
): Promise<OAuthCallbackResult> {
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
        redirect_uri: social_connections.redirect_uri,
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
    return {
      ok: false,
      error: {
        kind: "state_already_used",
        message: "This connection link was already used.",
      },
    };
  }

  if (new Date(connection.expires_at) < new Date()) {
    return failPendingConnection(
      connection.id,
      { status: "expired" },
      { kind: "state_expired", message: "OAuth connection has expired." },
    );
  }

  if (connection.platform !== input.platform) {
    return {
      ok: false,
      error: {
        kind: "platform_mismatch",
        message: "This connection link belongs to a different platform.",
      },
    };
  }

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

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return failPendingConnection(
        connection.id,
        {
          status: "failed",
          error_code: errorKind,
          error_message: `Share link validation failed: ${shareLinkValidation.reason}`,
        },
        { kind: errorKind, message: `Share link is no longer valid: ${shareLinkValidation.reason}.` },
      );
    }

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

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return failPendingConnection(
        connection.id,
        { status: "failed", error_code: ownerCapacity.reason, error_message: ownerRefusalMessage },
        { kind: ownerCapacity.reason, message: ownerRefusalMessage },
      );
    }
  }

  if (input.errorCode) {
    return failPendingConnection(
      connection.id,
      {
        status: "failed",
        error_code: input.errorCode,
        error_message: input.errorDescription ?? input.errorCode,
      },
      {
        kind: "provider_error",
        code: input.errorCode,
        message: input.errorDescription ?? "OAuth provider returned an error.",
      },
    );
  }

  const connectResult = await connectPlatformAccounts(input.platform, {
    code: input.code,
    redirectUri: connection.redirect_uri,
    codeVerifier: connection.oauth_code_verifier,
  });
  const [connectedAccount, ...otherAccounts] = connectResult.success
    ? connectResult.accounts
    : [];
  if (!connectResult.success || !connectedAccount) {
    const failureMessage = connectResult.success
      ? `No ${input.platform} account found to connect.`
      : connectResult.message;
    return failPendingConnection(
      connection.id,
      { status: "failed", error_code: "exchange_failed", error_message: failureMessage },
      { kind: "token_exchange_failed", message: failureMessage },
    );
  }
  if (otherAccounts.length > 0) {
    console.warn(
      `[handleOAuthCallback] ${otherAccounts.length + 1} ${input.platform} accounts returned; storing the first (${connectedAccount.accountIdentifier}).`,
    );
  }

  if (shareLinkId !== null) {
    const { data: consumeRows, error: consumeError } = await runQuery(
      db.execute(sql`select * from public.consume_share_link(${shareLinkId}::uuid)`),
    );

    const consumeResult = consumeRows?.[0];
    const consumeReason = consumeResult?.reason;

    if (consumeError) {
      console.error(
        `[handleOAuthCallback] consume_share_link failed: ${consumeError.message}`,
      );
      logShareLinkAudit(input.platform, "share_link.use_failed", "error");
      return failPendingConnection(
        connection.id,
        {
          status: "failed",
          error_code: "db_update_failed",
          error_message: "Could not record the share link use.",
        },
        {
          kind: "db_update_failed",
          message: "Could not record the share link use. Please open the link again.",
        },
      );
    }

    if (consumeResult?.success !== true) {
      const refusal = isConsumeRefusalReason(consumeReason)
        ? consumeReason
        : "not_found";
      const errorKind = SHARE_LINK_REFUSAL_KINDS[refusal];
      console.error(
        `[handleOAuthCallback] consume_share_link refused: ${refusal}`,
      );

      logShareLinkAudit(input.platform, "share_link.use_failed", "error");

      return failPendingConnection(
        connection.id,
        {
          status: "failed",
          error_code: errorKind,
          error_message: `Share link consumption failed: ${refusal}`,
        },
        { kind: errorKind, message: `Share link could not be used: ${refusal}.` },
      );
    }
  }

  const socialAccountValues = {
    ...buildSocialAccountValues(
      connection.principal_id,
      input.platform,
      connectedAccount,
    ),
    connection_id: connection.id,
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
    return failPendingConnection(
      connection.id,
      {
        status: "failed",
        error_code: "db_upsert_failed",
        error_message: upsertError?.message ?? "Failed to save account.",
      },
      { kind: "db_update_failed", message: "Failed to save social account." },
    );
  }

  const { data: connectedRows, error: connectError } = await runQuery(
    db
      .update(social_connections)
      .set({
        status: "connected",
        connected_at: new Date().toISOString(),
        social_account_id: socialAccount.id,
        oauth_code_verifier: null,
        updated_at: new Date().toISOString(),
      })
      .where(and(eq(social_connections.id, connection.id), eq(social_connections.status, "pending")))
      .returning({ id: social_connections.id })
  );

  if (connectError) {
    console.error(`[handleOAuthCallback] Failed to update social_connections: ${connectError.message}`);
    return failPendingConnection(
      connection.id,
      { status: "failed", error_code: "db_update_failed", error_message: connectError.message },
      { kind: "db_update_failed", message: "Failed to update connection status." },
    );
  }

  if (connectedRows.length === 0) {
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

  const accountUsername =
    connectedAccount.username ?? connectedAccount.displayName;

  return {
    ok: true,
    connectionId: connection.id,
    shareLinkId,
    initiatedVia: connection.initiated_via,
    accountUsername: accountUsername ?? undefined,
  };
}

async function failPendingConnection(
  connectionId: string,
  transition: PendingConnectionTransition,
  callbackError: CallbackError,
): Promise<OAuthCallbackResult> {
  const transitionWrite = await transitionPendingTo(connectionId, transition);
  if (!transitionWrite.ok) {
    console.error(
      `[failPendingConnection] CONNECTION LEFT PENDING: connection ${connectionId} could not move to ${transition.status} after a retry (${transitionWrite.message}); its status poll reports expired once expires_at passes.`,
    );
  }
  return { ok: false, error: callbackError };
}

async function transitionPendingTo(
  connectionId: string,
  fields: PendingConnectionTransition,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const updateFields: {
    status: "expired" | "failed";
    updated_at: string;
    oauth_code_verifier: null;
    failed_at?: string;
    error_code?: string;
    error_message?: string;
  } = {
    status: fields.status,
    updated_at: new Date().toISOString(),
    oauth_code_verifier: null,
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

  const { error } = await runWriteWithOneRetry(() =>
    db
      .update(social_connections)
      .set(updateFields)
      .where(and(eq(social_connections.id, connectionId), eq(social_connections.status, "pending"))),
  );
  return error ? { ok: false, message: error.message } : { ok: true };
}

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
