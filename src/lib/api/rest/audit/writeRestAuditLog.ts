import "server-only";

import { db, runQuery } from "@/db/client";
import { rest_audit_log, type REST_AUDIT_OUTCOMES } from "@/db/schema";
import { redactSecrets } from "@/lib/api/audit/redactPatterns";
import { toJsonValue } from "@/lib/utils/jsonObject";
import type { RestApiKeyContext } from "../auth/types";

export type RestAuditOutcome = (typeof REST_AUDIT_OUTCOMES)[number];

export type RestAuditWriteInput = {
  context: RestApiKeyContext;
  statusCode: number;
  outcome: RestAuditOutcome;
  errorCode: string | null;
  argsPayload: Record<string, unknown> | null;
  responseSummary: Record<string, unknown> | null;
  finishedAt: number;
};

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
      finishedAt,
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
      latency_ms: finishedAt - context.startedAt,
      args_redacted: toJsonValue(redactedArgs),
      response_summary: toJsonValue(responseSummary),
    };

    const { error: insertError } = await runQuery(
      db.insert(rest_audit_log).values(auditRowPayload),
    );

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
