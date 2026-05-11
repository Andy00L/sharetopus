import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { upsertMcpSession } from "@/actions/server/data/mcpSessions";
import type { Json } from "@/lib/types/database.types";
import type { McpPrincipal } from "./auth";

/**
 * Fields that get scrubbed from tool arguments before persisting.
 *
 * Anything that smells like a secret or credential. We match on key names
 * (case-insensitive) rather than values, because values are unpredictable.
 *
 * List: token, password, secret, authorization, bearer, api_key, apikey,
 * access_token, refresh_token, credential, private_key, jwt
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

/**
 * Appends a row to mcp_audit_log. Fire-and-forget in most call sites,
 * but we still await to make sure it lands.
 *
 * The table has an UPDATE-blocking trigger, so this is truly append-only.
 *
 * Called by: every tool handler in src/lib/mcp/tools/ and the route handler
 * Tables touched: mcp_audit_log (insert only)
 *
 * Failure modes:
 *   If the insert fails we log the error but do not throw. A broken audit
 *   row should not block the user's request.
 */
export async function logToolCall(entry: AuditEntry): Promise<void> {
  try {
    const redacted = entry.args ? redactSecrets(entry.args) : null;
    const argsJson = redacted ? truncateJson(redacted) : null;

    const sessionPromise =
      entry.sessionId && entry.principal?.principalId
        ? upsertMcpSession({
            id: entry.sessionId,
            principal_id: entry.principal.principalId,
            api_key_id:
              entry.principal.kind === "apikey"
                ? entry.principal.apiKeyId
                : null,
            oauth_client_id:
              entry.principal.kind === "oauth"
                ? entry.principal.oauthClientId
                : null,
            ip_hash: entry.ipHash ?? null,
            client_name: entry.clientName ?? null,
            client_version: entry.clientVersion ?? null,
          })
        : Promise.resolve({ success: true as const });

    const auditPromise = adminSupabase.from("mcp_audit_log").insert({
      principal_id: entry.principal?.principalId ?? null,
      oauth_client_id:
        entry.principal?.kind === "oauth"
          ? entry.principal.oauthClientId
          : null,
      api_key_id:
        entry.principal?.kind === "apikey" ? entry.principal.apiKeyId : null,
      session_id: entry.sessionId,
      tool_name: entry.toolName,
      args_redacted: argsJson as Json,
      result_status: entry.resultStatus,
      latency_ms: entry.latencyMs ?? null,
      ip_hash: entry.ipHash ?? null,
      user_agent: entry.userAgent ?? null,
    });

    const [sessionResult, auditResult] = await Promise.allSettled([
      sessionPromise,
      auditPromise,
    ]);

    if (sessionResult.status === "rejected") {
      console.error(
        `[logToolCall] Session upsert threw for ${entry.toolName}:`,
        sessionResult.reason
      );
    } else if (
      sessionResult.value &&
      "success" in sessionResult.value &&
      !sessionResult.value.success
    ) {
      console.error(
        `[logToolCall] Session upsert failed for ${entry.toolName}:`,
        "message" in sessionResult.value ? sessionResult.value.message : ""
      );
    }

    if (auditResult.status === "rejected") {
      console.error(
        `[logToolCall] Audit insert threw for ${entry.toolName}:`,
        auditResult.reason
      );
    } else if (auditResult.value?.error) {
      console.error(
        `[logToolCall] Failed to insert audit row for ${entry.toolName}:`,
        auditResult.value.error.message
      );
    }
  } catch (err) {
    console.error(
      `[logToolCall] Unexpected error writing audit log:`,
      err instanceof Error ? err.message : err
    );
  }
}

/**
 * Recursively walks an object and replaces values whose keys match
 * REDACT_KEYS with "[REDACTED]". Also catches anything that looks
 * like a JWT (three dot-separated base64 segments).
 */
function redactSecrets(
  obj: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.test(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string" && looksLikeJwt(value)) {
      result[key] = "[REDACTED_JWT]";
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
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
  // Truncate and mark it
  return { _truncated: true, _preview: str.slice(0, MAX_ARGS_LENGTH) };
}
