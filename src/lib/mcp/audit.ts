import "server-only";

import { db, runQuery } from "@/db/client";
import { mcp_audit_log } from "@/db/schema";
import { redactSecrets, truncateJson } from "@/lib/api/audit/redactPatterns";
import { toJsonValue } from "@/lib/utils/jsonObject";

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

export async function logToolCall(entry: AuditEntry): Promise<void> {
  try {
    const redacted = entry.args ? redactSecrets(entry.args) : null;
    const argsJson = redacted ? truncateJson(redacted) : null;

    const { error: auditError } = await runQuery(
      db.insert(mcp_audit_log).values({
        principal_id: entry.principal?.principalId ?? null,
        oauth_client_id: entry.principal
          ? oauthClientIdFromPrincipal(entry.principal)
          : null,
        api_key_id: entry.principal
          ? apiKeyIdFromPrincipal(entry.principal)
          : null,
        session_id: entry.requestId,
        tool_name: entry.toolName,
        args_redacted: toJsonValue(argsJson),
        result_status: entry.resultStatus,
        latency_ms: entry.latencyMs ?? null,
        ip_hash: entry.ipHash ?? null,
        user_agent: entry.userAgent ?? null,
      }),
    );

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
