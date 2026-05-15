import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { redactSecrets } from "@/lib/api/audit/redactPatterns";
import type { Json } from "@/lib/types/database.types";
import type { RestApiKeyContext } from "../auth/types";

export type RestAuditOutcome =
  | "success"
  | "validation_error"
  | "auth_error"
  | "rate_limited"
  | "internal_error";

export type RestAuditWriteInput = {
  context: RestApiKeyContext;
  statusCode: number;
  outcome: RestAuditOutcome;
  errorCode: string | null;
  argsPayload: Record<string, unknown> | null;
  responseSummary: Record<string, unknown> | null;
};

/**
 * Writes one row to rest_audit_log. Never throws.
 *
 * Args payload redacted via the shared redactSecrets helper (same
 * patterns MCP uses). Latency computed from context.startedAt to now.
 *
 * Caller pattern: called once per request from inside withRestEndpoint.
 * Awaited so the row lands before the function returns. If insert
 * fails, log a warning and return; the request is already complete.
 */
export async function writeRestAuditLog(
  input: RestAuditWriteInput,
): Promise<void> {
  try {
    const {
      context,
      statusCode,
      outcome,
      errorCode,
      argsPayload,
      responseSummary,
    } = input;

    const redactedArgs = argsPayload ? redactSecrets(argsPayload) : null;

    const auditRowPayload = {
      principal_id: context.principal.principalId,
      api_key_id: context.principal.apiKeyId,
      endpoint: context.endpoint,
      http_method: context.httpMethod,
      request_id: context.requestId,
      ip_hash: context.ipHash,
      user_agent: context.userAgent,
      status_code: statusCode,
      outcome,
      error_code: errorCode,
      latency_ms: Date.now() - context.startedAt,
      args_redacted: redactedArgs as Json,
      response_summary: responseSummary as Json,
    };

    const { error: insertError } = await adminSupabase
      .from("rest_audit_log")
      .insert(auditRowPayload);

    if (insertError) {
      console.warn(
        `[writeRestAuditLog] insert failed (request_id=${context.requestId}):`,
        insertError.message,
      );
    }
  } catch (unexpectedError) {
    console.warn(
      "[writeRestAuditLog] unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
  }
}
