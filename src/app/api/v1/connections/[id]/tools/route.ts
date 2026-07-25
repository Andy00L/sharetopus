import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import {
  listProviderToolsForAccount,
  runProviderToolForAccount,
} from "@/lib/platforms/providers/runProviderTool";

/**
 * Generic provider-tool surface for one connection.
 *
 *   GET  /v1/connections/{id}/tools  -> discovery: what can be triggered
 *   POST /v1/connections/{id}/tools  -> trigger one of them
 *
 * One route serves every provider helper (list Discord channels, list
 * Slack channels, resolve a Telegram chat, and whatever a future provider
 * declares), because the tool list and its parameter schema come from the
 * provider declaration rather than from per-helper routes.
 *
 * Ownership is enforced in the service layer by scoping the account lookup
 * to the calling principal, so another principal's connection id reports
 * not-found rather than forbidden.
 */

const ConnectionIdSchema = z.guid();

/** Trailing path segment is "tools", so the id is the one before it. */
function extractConnectionId(requestUrl: string): string {
  const segments = new URL(requestUrl).pathname.split("/");
  return segments[segments.length - 2] ?? "";
}

const TriggerBodySchema = z.object({
  method_name: z.string().min(1).max(100),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.tools.list",
  handler: async (ctx, request) => {
    const idParseResult = ConnectionIdSchema.safeParse(
      extractConnectionId(request.url),
    );
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid connection id format",
        ctx.requestId,
      );
    }

    const discovery = await listProviderToolsForAccount({
      principalId: ctx.principal.principalId,
      socialAccountId: idParseResult.data,
    });

    if (!discovery.ok) {
      // A missing account is the caller's problem (404); an unconfigured
      // provider is ours (500), and the message says which.
      return restErrorResponse(
        discovery.reason === "account_not_found" ? "not_found" : "internal_error",
        discovery.message,
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          provider: discovery.providerId,
          provider_label: discovery.providerLabel,
          tools: discovery.tools.map((tool) => ({
            method_name: tool.methodName,
            description: tool.description,
            parameters: tool.parameters.map((parameter) => ({
              name: parameter.name,
              type: parameter.kind,
              required: parameter.required,
              description: parameter.description,
            })),
          })),
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: idParseResult.data,
        provider: discovery.providerId,
        tool_count: discovery.tools.length,
      },
    };
  },
});

export const POST = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.connections.tools.trigger",
  handler: async (ctx, request) => {
    const idParseResult = ConnectionIdSchema.safeParse(
      extractConnectionId(request.url),
    );
    if (!idParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Invalid connection id format",
        ctx.requestId,
      );
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return restErrorResponse(
        "validation_error",
        "Request body is not valid JSON",
        ctx.requestId,
      );
    }

    const bodyParseResult = TriggerBodySchema.safeParse(rawBody);
    if (!bodyParseResult.success) {
      return restErrorResponse(
        "validation_error",
        "Request body failed validation",
        ctx.requestId,
        { issues: bodyParseResult.error.issues },
      );
    }

    const toolResult = await runProviderToolForAccount({
      principalId: ctx.principal.principalId,
      socialAccountId: idParseResult.data,
      methodName: bodyParseResult.data.method_name,
      parameters: bodyParseResult.data.parameters,
    });

    if (!toolResult.ok) {
      // Distinct statuses per failure mode so a caller can tell a bad tool
      // name from a missing parameter from an upstream provider failure.
      const statusKind =
        toolResult.reason === "account_not_found"
          ? "not_found"
          : toolResult.reason === "unknown_tool" ||
              toolResult.reason === "missing_parameter" ||
              toolResult.reason === "no_credential"
            ? "validation_error"
            : "internal_error";

      return {
        response: restErrorResponse(
          statusKind,
          toolResult.message,
          ctx.requestId,
        ),
        auditSummary: {
          connection_id: idParseResult.data,
          method_name: bodyParseResult.data.method_name,
          outcome: toolResult.reason,
        },
      };
    }

    return {
      response: NextResponse.json(
        {
          method_name: bodyParseResult.data.method_name,
          result: toolResult.data,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        connection_id: idParseResult.data,
        method_name: bodyParseResult.data.method_name,
        outcome: "ok",
      },
    };
  },
});
