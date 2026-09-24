import "server-only";

import { and, eq } from "drizzle-orm";

import { verifyConnectionToken } from "@/lib/x402/oauth/connectionToken";
import { MAX_POLLS_PER_CONNECTION } from "@/lib/x402/config";
import { db, runQuery } from "@/db/client";
import { social_connections } from "@/db/schema";

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
        | { kind: "server_misconfigured"; message: string }
        | { kind: "poll_limit_exceeded"; message: string }
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
 *   3. Enforce the per-connection poll cap (MAX_POLLS_PER_CONNECTION)
 *   4. Increment poll_count, set last_polled_at / last_polled_ip_hash
 *   5. Lazily mark a pending-but-expired connection as expired
 *   6. Return the status payload
 *
 * The connection is addressed only via the unguessable HMAC token, never an
 * enumerable id, so a poll cannot read other users' connections.
 *
 * Called by: GET /api/x402/oauth/status
 * Tables touched: social_connections (read + update)
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
    // A missing HMAC secret is OUR misconfiguration, not the caller's bad
    // token; surfacing it as 401 would send agents into a re-auth loop.
    if (tokenResult.error === "missing_secret") {
      return {
        ok: false,
        error: { kind: "server_misconfigured", message: "Status polling is not configured on the server." },
      };
    }
    const errorKind =
      tokenResult.error === "expired" ? "token_expired" : "invalid_token";
    return {
      ok: false,
      error: { kind: errorKind, message: tokenResult.message },
    };
  }

  const { connectionId } = tokenResult.payload;

  // -- 2. Look up connection
  const { data: connectionRows, error: dbError } = await runQuery(
    db
      .select({
        id: social_connections.id,
        platform: social_connections.platform,
        status: social_connections.status,
        connected_at: social_connections.connected_at,
        expires_at: social_connections.expires_at,
        social_account_id: social_connections.social_account_id,
        poll_count: social_connections.poll_count,
        error_code: social_connections.error_code,
        error_message: social_connections.error_message,
      })
      .from(social_connections)
      .where(eq(social_connections.id, connectionId))
      .limit(1)
  );

  if (dbError) {
    console.error(`[handleStatusQuery] DB error: ${dbError.message}`);
    return {
      ok: false,
      error: { kind: "db_error", message: "Failed to query connection." },
    };
  }

  const connection = connectionRows[0];
  if (!connection) {
    return {
      ok: false,
      error: {
        kind: "connection_not_found",
        message: "Connection not found.",
      },
    };
  }

  // -- 3. Poll cap. Token expiry already bounds the polling window; this
  //       bounds total volume per connection on top of the per-IP limit.
  if (connection.poll_count >= MAX_POLLS_PER_CONNECTION) {
    return {
      ok: false,
      error: {
        kind: "poll_limit_exceeded",
        message: `Poll limit reached for this connection (${MAX_POLLS_PER_CONNECTION}).`,
      },
    };
  }

  // -- 4. Increment poll_count + update last_polled fields. The increment is
  //       read-then-write: concurrent polls may lose an increment, which is
  //       acceptable for telemetry and only ever under-counts toward the cap.
  const newPollCount = connection.poll_count + 1;
  const { error: pollUpdateError } = await runQuery(
    db
      .update(social_connections)
      .set({
        poll_count: newPollCount,
        last_polled_at: new Date().toISOString(),
        last_polled_ip_hash: ipHash,
        updated_at: new Date().toISOString(),
      })
      .where(eq(social_connections.id, connectionId))
  );
  if (pollUpdateError) {
    // Best-effort telemetry write; the poll itself still succeeds.
    console.error(`[handleStatusQuery] poll_count update failed for ${connectionId}: ${pollUpdateError.message}`);
  }

  // -- 5. Lazily mark a pending-but-expired connection as expired
  let status = connection.status;
  if (
    status === "pending" &&
    new Date(connection.expires_at) < new Date()
  ) {
    status = "expired";
    const { error: expireError } = await runQuery(
      db
        .update(social_connections)
        .set({ status: "expired", updated_at: new Date().toISOString() })
        .where(and(eq(social_connections.id, connectionId), eq(social_connections.status, "pending")))
    );
    if (expireError) {
      // Best-effort: the response already reports expired; the row catches
      // up on the next poll or via the cleanup cron.
      console.error(`[handleStatusQuery] expired transition failed for ${connectionId}: ${expireError.message}`);
    }
  }

  // -- 6. Return payload
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
