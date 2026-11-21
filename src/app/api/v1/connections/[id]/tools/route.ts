import { NextResponse } from "next/server";
import { z } from "zod";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { ConnectionToolTriggerInputSchema } from "@/lib/api/rest/validation/connectionSchemas";
import type {
  ConnectionToolList,
  ConnectionToolResult,
} from "@/lib/api/rest/openapi/responseSchemas";
import {
  listProviderToolsForAccount,
  runProviderToolForAccount,
} from "@/lib/platforms/providers/runProviderTool";

const ConnectionIdSchema = z.guid();

function extractConnectionId(requestUrl: string): string {
  const segments = new URL(requestUrl).pathname.split("/");
  return segments[segments.length - 2] ?? "";
}

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
        } satisfies ConnectionToolList,
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

    const bodyParseResult = ConnectionToolTriggerInputSchema.safeParse(rawBody);
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
        } satisfies ConnectionToolResult,
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
