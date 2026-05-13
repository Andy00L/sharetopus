import "server-only";

import { verifyConnectionToken } from "@/lib/x402/oauth/connectionToken";
import { adminSupabase } from "@/actions/api/adminSupabase";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusQueryInput {
  connectionToken: string;
}

export type StatusQueryResult =
  | { ok: true; payload: StatusPayload }
  | {
      ok: false;
      error:
        | { kind: "missing_token"; message: string }
        | { kind: "invalid_token"; message: string }
        | { kind: "token_expired"; message: string }
        | { kind: "connection_not_found"; message: string }
        | { kind: "db_error"; message: string };
    };

export interface StatusPayload {
  connectionId: string;
  platform: string;
  status: "pending" | "connected" | "expired" | "failed" | "revoked";
  connectedAt: string | null;
  expiresAt: string;
  socialAccountId: string | null;
  pollCount: number;
  errorCode: string | null;
  errorMessage: string | null;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Polling endpoint logic.
 *
 * Flow:
 *   1. Verify HMAC connectionToken via verifyConnectionToken
 *   2. SELECT social_connections WHERE id = payload.connectionId
 *   3. Increment poll_count, set last_polled_at, last_polled_ip_hash
 *   4. Return status payload
 */
export async function handleStatusQuery(
  input: StatusQueryInput,
  ipHash: string | null
): Promise<StatusQueryResult> {
  if (!input.connectionToken) {
    return {
      ok: false,
      error: {
        kind: "missing_token",
        message: "Authorization Bearer token is required.",
      },
    };
  }

  // -- 1. Verify HMAC token
  const tokenResult = verifyConnectionToken(input.connectionToken);
  if (!tokenResult.ok) {
    const errorKind =
      tokenResult.error === "expired" ? "token_expired" : "invalid_token";
    return {
      ok: false,
      error: { kind: errorKind, message: tokenResult.message },
    };
  }

  const { connectionId } = tokenResult.payload;

  // -- 2. Look up connection
  const { data: connection, error: dbError } = await adminSupabase
    .from("social_connections")
    .select(
      "id, platform, status, connected_at, expires_at, social_account_id, poll_count, error_code, error_message"
    )
    .eq("id", connectionId)
    .maybeSingle();

  if (dbError) {
    console.error(`[handleStatusQuery] DB error: ${dbError.message}`);
    return {
      ok: false,
      error: { kind: "db_error", message: "Failed to query connection." },
    };
  }

  if (!connection) {
    return {
      ok: false,
      error: {
        kind: "connection_not_found",
        message: "Connection not found.",
      },
    };
  }

  // -- 3. Increment poll_count + update last_polled fields
  const newPollCount = connection.poll_count + 1;
  await adminSupabase
    .from("social_connections")
    .update({
      poll_count: newPollCount,
      last_polled_at: new Date().toISOString(),
      last_polled_ip_hash: ipHash,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connectionId);

  // Check if connection has expired but status not yet updated
  let status = connection.status;
  if (
    status === "pending" &&
    new Date(connection.expires_at) < new Date()
  ) {
    status = "expired";
    await adminSupabase
      .from("social_connections")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("status", "pending");
  }

  // -- 4. Return payload
  return {
    ok: true,
    payload: {
      connectionId: connection.id,
      platform: connection.platform,
      status,
      connectedAt: connection.connected_at,
      expiresAt: connection.expires_at,
      socialAccountId: connection.social_account_id,
      pollCount: newPollCount,
      errorCode: connection.error_code,
      errorMessage: connection.error_message,
    },
  };
}
