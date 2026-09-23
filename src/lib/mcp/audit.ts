import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { Json } from "@/lib/types/database.types";
import { redactSecrets, truncateJson } from "@/lib/api/audit/redactPatterns";

import { assertExhaustiveKind, type McpPrincipal } from "./auth/types";

function logPrefix(
  toolName: string,
  requestId: string | null | undefined,
): string {
  return `[logToolCall] [req=${requestId ?? "?"}] [${toolName}]`;
}

interface AuditEntry {
  principal: McpPrincipal | null;
  requestId: string | null;
  toolName: string;
  args: Record<string, unknown> | null;
  resultStatus: "ok" | "error" | "denied" | "rate_limited" | "quota_exceeded";
  latencyMs?: number;
  ipHash?: string | null;
  userAgent?: string | null;
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
 * Appends a row to mcp_audit_log. The INSERT is awaited so the caller
 * knows the truth-source row landed. mcp_audit_log has an UPDATE-blocking
 * trigger, so this is truly append-only.
 *
 * session_id holds the per-request correlation ID: the stateless
 * transport has no longer-lived session to record. No client name is
 * stored per call, because clientInfo arrives only on the initialize
 * handshake, which never reaches a tool. To see which client made a
 * call, JOIN mcp_oauth_clients on oauth_client_id.
 *
 * Called by: withMcpTool (src/lib/mcp/withMcpTool.ts), once per tool call
 * Tables touched: mcp_audit_log (insert only)
 *
 * Failure modes:
 *   If the insert fails we log the error but do not throw. A broken
 *   audit row should not block the user's request.
 */
export async function logToolCall(entry: AuditEntry): Promise<void> {
  try {
    const redacted = entry.args ? redactSecrets(entry.args) : null;
    const argsJson = redacted ? truncateJson(redacted) : null;

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
        session_id: entry.requestId,
        tool_name: entry.toolName,
        args_redacted: argsJson as Json,
        result_status: entry.resultStatus,
        latency_ms: entry.latencyMs ?? null,
        ip_hash: entry.ipHash ?? null,
        user_agent: entry.userAgent ?? null,
      });

    if (auditError) {
      console.error(
        `${logPrefix(entry.toolName, entry.requestId)} Failed to insert audit row for ${entry.toolName}:`,
        auditError.message,
      );
    }
  } catch (err) {
    console.error(
      `${logPrefix(entry.toolName, entry.requestId)} Unexpected error writing audit log:`,
      err instanceof Error ? err.message : err,
    );
  }
}
