import "server-only";

import type {
  AuthInfo,
  CallToolResult,
  ServerContext,
} from "@modelcontextprotocol/server";

import { waitUntil } from "@vercel/functions";

import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";

import { logToolCall } from "./audit";
import type { McpPrincipal } from "./auth/types";
import { extractIpHash, extractUserAgent } from "@/lib/api/context";
import { extractPrincipal, extractRequestId } from "./context";
import { entitlementFor } from "./entitlement";
import { MCP_TOOL_CALL_RATE_LIMIT } from "./rateLimits";
import type { McpToolName } from "./toolNames";

type McpToolContext = {
  principal: McpPrincipal;
  requestId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  startedAt: number;
};

type AuditStatus = "ok" | "error" | "denied" | "rate_limited" | "quota_exceeded";

type McpHandlerResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  auditStatus?: AuditStatus;
  auditArgs?: Record<string, unknown> | null;
};

export function jsonResult<TValue extends Record<string, unknown>>(
  value: TValue,
  auditArgs?: Record<string, unknown> | null,
): McpHandlerResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(auditArgs !== undefined ? { auditArgs } : {}),
  };
}

export function errorResult(
  message: string,
  auditStatus: AuditStatus = "error",
): McpHandlerResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
    auditStatus,
  };
}

type WithMcpToolOptions<TArgs> = {
  auditArgsBuilder?: (args: TArgs) => Record<string, unknown> | null;
};

export function withMcpTool<TArgs>(
  toolName: McpToolName,
  handler: (ctx: McpToolContext, args: TArgs) => Promise<McpHandlerResult>,
  options: WithMcpToolOptions<TArgs> = {},
): (args: TArgs, serverContext: Pick<ServerContext, "http">) => Promise<CallToolResult> {
  return async (args, serverContext) => {
    const ctx = await buildContext(serverContext.http?.authInfo);
    const defaultAuditArgs = options.auditArgsBuilder
      ? options.auditArgsBuilder(args)
      : rawArgsAsAuditPayload(args);

    const principalLimit = await checkRateLimit({
      operation: "mcp_tool_call",
      identifier: ctx.principal.principalId,
      rule: {
        limit: MCP_TOOL_CALL_RATE_LIMIT.calls,
        windowSeconds: MCP_TOOL_CALL_RATE_LIMIT.windowSeconds,
      },
    });
    if (!principalLimit.success && principalLimit.reason === "limited") {
      emitAudit(ctx, toolName, defaultAuditArgs, "rate_limited");
      return {
        content: [
          {
            type: "text" as const,
            text: `Rate limited: at most ${MCP_TOOL_CALL_RATE_LIMIT.calls} tool calls per ${MCP_TOOL_CALL_RATE_LIMIT.windowSeconds} s. Retry in ${principalLimit.resetIn} s.`,
          },
        ],
        isError: true,
      };
    }
    if (!principalLimit.success) {
      console.warn(
        `[withMcpTool] Rate limiter ${principalLimit.reason} for ${toolName}; continuing without the per-principal budget.`,
      );
    }

    const entitlement = await entitlementFor(ctx.principal, toolName);
    if (entitlement.mode === "deny") {
      const isQuota =
        entitlement.reason === "platform_quota" || entitlement.reason === "monthly_quota";
      emitAudit(ctx, toolName, defaultAuditArgs, isQuota ? "quota_exceeded" : "denied");
      return {
        content: [{ type: "text" as const, text: `Denied: ${entitlement.detail}` }],
        isError: true,
      };
    }

    try {
      const result = await handler(ctx, args);
      const finalAuditStatus = result.auditStatus ?? (result.isError ? "error" : "ok");
      const finalAuditArgs =
        result.auditArgs !== undefined ? result.auditArgs : defaultAuditArgs;
      emitAudit(ctx, toolName, finalAuditArgs, finalAuditStatus);

      return {
        content: result.content,
        ...(result.structuredContent && !result.isError
          ? { structuredContent: result.structuredContent }
          : {}),
        isError: result.isError,
      };
    } catch (err) {
      console.error(
        `[withMcpTool] ${toolName} threw for request ${ctx.requestId ?? "unknown"}:`,
        err instanceof Error ? err.message : err,
      );
      emitAudit(ctx, toolName, defaultAuditArgs, "error");
      return {
        content: [{ type: "text" as const, text: `${toolName} failed with an internal error. Retry, or contact support if it persists.` }],
        isError: true,
      };
    }
  };
}

async function buildContext(
  authInfo: AuthInfo | undefined,
): Promise<McpToolContext> {
  return {
    principal: extractPrincipal(authInfo),
    requestId: extractRequestId(authInfo),
    ipHash: await extractIpHash(),
    userAgent: await extractUserAgent(),
    startedAt: Date.now(),
  };
}

function rawArgsAsAuditPayload(
  rawArgs: unknown,
): Record<string, unknown> | null {
  if (rawArgs === null || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return null;
  const argsRecord = Object.fromEntries(Object.entries(rawArgs));
  return Object.keys(argsRecord).length === 0 ? null : argsRecord;
}

function emitAudit(
  ctx: McpToolContext,
  toolName: McpToolName,
  args: Record<string, unknown> | null,
  resultStatus: AuditStatus,
): void {
  waitUntil(logToolCall({
    principal: ctx.principal,
    requestId: ctx.requestId,
    toolName,
    args,
    resultStatus,
    latencyMs: Date.now() - ctx.startedAt,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
  }));
}
