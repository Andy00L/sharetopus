import "server-only";

import { waitUntil } from "@vercel/functions";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { upsertMcpSession } from "@/actions/server/data/mcpSessions";
import type { Json } from "@/lib/types/database.types";

import { assertExhaustiveKind, type McpPrincipal } from "./auth/types";

/**
 * Fields that get scrubbed from tool arguments before persisting.
 *
 * Anything that smells like a secret or credential. We match on key
 * names (case-insensitive) rather than values, because values are
 * unpredictable.
 *
 * List: token, password, secret, authorization, bearer, api_key,
 * apikey, access_token, refresh_token, credential, private_key, jwt
 */
const REDACT_KEYS =
  /^(token|password|secret|authorization|bearer|api_key|apikey|access_token|refresh_token|credential|private_key|jwt)$/i;

/** Max size (in chars) for args_redacted. Anything longer gets truncated. */
const MAX_ARGS_LENGTH = 4096;

interface AuditEntry {
  principal: McpPrincipal | null;
  sessionId: string | null;
  toolName: string;
  args: Record<string, unknown> | null;
  resultStatus: "ok" | "error" | "denied" | "rate_limited" | "quota_exceeded";
  latencyMs?: number;
  ipHash?: string | null;
  userAgent?: string | null;
  clientName?: string | null;
  clientVersion?: string | null;
}

function apiKeyIdFromPrincipal(principal: McpPrincipal): string | null {
  switch (principal.kind) {
    case "apikey":
      return principal.apiKeyId;
    case "oauth":
      return null;
    default:
      return assertExhaustiveKind(principal);
  }
}

function oauthClientIdFromPrincipal(principal: McpPrincipal): string | null {
  switch (principal.kind) {
    case "oauth":
      return principal.oauthClientId;
    case "apikey":
      return null;
    default:
      return assertExhaustiveKind(principal);
  }
}

/**
 * Appends a row to mcp_audit_log. The audit INSERT is awaited so the
 * caller knows the truth-source row landed. The mcp_sessions UPSERT
 * runs in the background via waitUntil so it never adds latency to
 * the user-facing request.
 *
 * mcp_audit_log has an UPDATE-blocking trigger, so this is truly
 * append-only.
 *
 * client_name handling:
 *   clientName arrives only on the MCP initialize handshake, which
 *   never triggers logToolCall directly. So `entry.clientName` is
 *   null on every tool-call audit row by design. We store null here
 *   instead of hydrating from mcp_oauth_clients per call (the previous
 *   behavior cost one extra SELECT on every OAuth tool call). To
 *   recover client_name for analytics, JOIN mcp_audit_log with
 *   mcp_oauth_clients on oauth_client_id at query time.
 *
 * mcp_sessions UPSERT:
 *   The synthetic per-request UUID means each tool call creates a new
 *   row. Useful for capturing analytics breadcrumbs (ip_hash, client_*)
 *   but does NOT need to block the request. Moved to waitUntil so the
 *   serverless function keeps the write alive while the response goes
 *   back to the user.
 *
 * Called by: every tool handler in src/lib/mcp/tools/ and the route handler
 * Tables touched: mcp_audit_log (insert only), mcp_sessions (UPSERT, background)
 *
 * Failure modes:
 *   If the insert fails we log the error but do not throw. A broken
 *   audit row should not block the user's request.
 */
export async function logToolCall(entry: AuditEntry): Promise<void> {
  try {
    const redacted = entry.args ? redactSecrets(entry.args) : null;
    const argsJson = redacted ? truncateJson(redacted) : null;

    // Session UPSERT fires in the background. Right tool for "I want
    // this write to land but the user does not need to wait for it".
    // Errors are logged and swallowed: a failed session row is not
    // worth retrying the whole request.
    if (entry.sessionId && entry.principal?.principalId) {
      const sessionPayload = {
        id: entry.sessionId,
        principal_id: entry.principal.principalId,
        api_key_id: apiKeyIdFromPrincipal(entry.principal),
        oauth_client_id: oauthClientIdFromPrincipal(entry.principal),
        ip_hash: entry.ipHash ?? null,
        client_name: entry.clientName ?? null,
        client_version: entry.clientVersion ?? null,
      };

      waitUntil(
        (async () => {
          try {
            const sessionResult = await upsertMcpSession(sessionPayload);
            if (
              sessionResult &&
              "success" in sessionResult &&
              !sessionResult.success
            ) {
              console.error(
                `[logToolCall] Session upsert failed for ${entry.toolName}:`,
                "message" in sessionResult ? sessionResult.message : "",
              );
            }
          } catch (sessionErr) {
            console.error(
              `[logToolCall] Session upsert threw for ${entry.toolName}:`,
              sessionErr instanceof Error ? sessionErr.message : sessionErr,
            );
          }
        })(),
      );
    }

    // Audit INSERT stays awaited. This is the truth-source row for
    // compliance, billing, and security forensics; we want to know
    // synchronously whether it landed.
    const { error: auditError } = await adminSupabase
      .from("mcp_audit_log")
      .insert({
        principal_id: entry.principal?.principalId ?? null,
        oauth_client_id: entry.principal
          ? oauthClientIdFromPrincipal(entry.principal)
          : null,
        api_key_id: entry.principal
          ? apiKeyIdFromPrincipal(entry.principal)
          : null,
        session_id: entry.sessionId,
        tool_name: entry.toolName,
        args_redacted: argsJson as Json,
        result_status: entry.resultStatus,
        latency_ms: entry.latencyMs ?? null,
        ip_hash: entry.ipHash ?? null,
        user_agent: entry.userAgent ?? null,
      });

    if (auditError) {
      console.error(
        `[logToolCall] Failed to insert audit row for ${entry.toolName}:`,
        auditError.message,
      );
    }
  } catch (err) {
    console.error(
      `[logToolCall] Unexpected error writing audit log:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Recursively walks an object and replaces values whose keys match
 * REDACT_KEYS with "[REDACTED]". Also catches anything that looks
 * like a JWT (three dot-separated base64 segments).
 */
function redactSecrets(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && looksLikeJwt(value)) {
      result[key] = "[REDACTED_JWT]";
    } else if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      result[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Rough JWT detector: three base64url segments separated by dots. */
function looksLikeJwt(s: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(s);
}

/** Truncate to MAX_ARGS_LENGTH chars. Returns the parsed-safe JSON object. */
function truncateJson(obj: Record<string, unknown>): Record<string, unknown> {
  const str = JSON.stringify(obj);
  if (str.length <= MAX_ARGS_LENGTH) return obj;
  return { _truncated: true, _preview: str.slice(0, MAX_ARGS_LENGTH) };
}
