import "server-only";

import { logToolCall } from "./audit";
import type { McpPrincipal } from "./auth";
import {
  extractClientName,
  extractClientVersion,
  extractIpHash,
  extractPrincipal,
  extractSessionId,
  extractUserAgent,
} from "./context";
import { entitlementFor } from "./entitlement";
import type { McpToolName } from "./toolNames";

/**
 * Resolved per-request context shared with every tool handler.
 * `startedAt` lets handlers compute their own intermediate latencies
 * if they want, although the HOF computes the audit latencyMs from
 * this value automatically.
 */
export type McpToolContext = {
  principal: McpPrincipal;
  sessionId: string | null;
  ipHash: string | null;
  userAgent: string | null;
  clientName: string | null;
  clientVersion: string | null;
  startedAt: number;
};

/**
 * The shape every tool handler returns. Matches the MCP SDK's expected
 * content envelope, plus two optional knobs:
 *   - auditStatus: override the result_status sent to mcp_audit_log
 *     (default is "ok" when isError is falsy, else "error"). Use this
 *     for rate-limit branches that should log as "rate_limited" instead
 *     of "error".
 *   - auditArgs: override the args payload sent to the audit log
 *     (default is the value built by the HOF, see WithMcpToolOptions
 *     below). Use this when the result-time view of args differs from
 *     the request-time view (e.g. include the generated storage_path).
 */
export type McpHandlerResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  auditStatus?: "ok" | "error" | "denied" | "rate_limited" | "quota_exceeded";
  auditArgs?: Record<string, unknown> | null;
};

/**
 * Per-tool HOF options.
 *
 * `auditArgsBuilder` is the canonical place to scrub or summarize the
 * args before they hit mcp_audit_log. It runs in EVERY audit path:
 *   - deny (entitlement gate fired)
 *   - thrown error (handler threw, args still need a row)
 *   - success / handler-error (only if the handler did NOT return its
 *     own `auditArgs` override)
 *
 * Use this when the raw args are large (bulk_schedule.posts) or
 * contain free-form text you do not want persisted (additional_context
 * on generate_post_draft). Without it, the HOF logs the raw args.
 */
type WithMcpToolOptions<TArgs> = {
  auditArgsBuilder?: (args: TArgs) => Record<string, unknown> | null;
};

type ToolHandlerCallback = (
  args: unknown,
  extra: Record<string, unknown>,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

/**
 * Wraps a tool's business logic with the shared boilerplate every MCP
 * tool needs:
 *   1. Extract per-request context (principal, session, ip, ua, client)
 *   2. Compute the default audit args payload (auditArgsBuilder if
 *      provided, else the raw args coerced via rawArgsAsAuditPayload)
 *   3. Run the entitlement gate (tier + monthly quota)
 *   4. On deny: emit the audit row with the right status + return the
 *      standard denied response
 *   5. On allow: call the inner handler
 *   6. On success or handler-returned isError: emit the audit row.
 *      Handler may override status via `auditStatus` (e.g.
 *      "rate_limited") and override args via `auditArgs` (e.g. include
 *      generated storage_path).
 *   7. On thrown error: emit an "error" audit row with the default
 *      audit args and re-throw so the SDK can surface a JSON-RPC error.
 *
 * The handler only writes its business logic. Audit consistency,
 * latency accounting, and deny semantics are guaranteed by this wrapper.
 *
 * Usage:
 *   server.registerTool(
 *     "schedule_post",
 *     { ...config },
 *     withMcpTool("schedule_post", async (ctx, args) => { ... }),
 *   );
 *
 * With per-tool args scrubbing:
 *   withMcpTool(
 *     "bulk_schedule",
 *     async (ctx, args) => { ... },
 *     { auditArgsBuilder: (args) => ({ count: args.posts.length }) },
 *   );
 */
export function withMcpTool<TArgs>(
  toolName: McpToolName,
  handler: (ctx: McpToolContext, args: TArgs) => Promise<McpHandlerResult>,
  options: WithMcpToolOptions<TArgs> = {},
): ToolHandlerCallback {
  return async (rawArgs, extra) => {
    const ctx = await buildContext(extra);
    const typedArgs = rawArgs as TArgs;

    // Compute once: used on deny + thrown-error paths, and as the
    // fallback when the handler does not return its own auditArgs.
    const defaultAuditArgs = options.auditArgsBuilder
      ? options.auditArgsBuilder(typedArgs)
      : rawArgsAsAuditPayload(rawArgs);

    const entitlement = await entitlementFor(ctx.principal, toolName);
    if (entitlement.mode === "deny") {
      const denyStatus: McpHandlerResult["auditStatus"] =
        entitlement.reason === "platform_quota" ||
        entitlement.reason === "monthly_quota"
          ? "quota_exceeded"
          : "denied";

      await emitAudit(ctx, toolName, defaultAuditArgs, denyStatus);

      return {
        content: [
          {
            type: "text" as const,
            text: `Denied: ${entitlement.detail ?? entitlement.reason}`,
          },
        ],
        isError: true,
      };
    }

    try {
      const result = await handler(ctx, typedArgs);

      const finalAuditStatus: McpHandlerResult["auditStatus"] =
        result.auditStatus ?? (result.isError ? "error" : "ok");

      // Handler-returned auditArgs takes precedence (even when set to
      // null explicitly). Falls back to the default computed above.
      const finalAuditArgs =
        result.auditArgs !== undefined ? result.auditArgs : defaultAuditArgs;

      await emitAudit(ctx, toolName, finalAuditArgs, finalAuditStatus);

      return {
        content: result.content,
        isError: result.isError,
      };
    } catch (err) {
      await emitAudit(ctx, toolName, defaultAuditArgs, "error");
      throw err;
    }
  };
}

/**
 * Bundles the six extract* calls into one context object so each
 * handler does not re-do the same work.
 */
async function buildContext(
  extra: Record<string, unknown>,
): Promise<McpToolContext> {
  const principal = extractPrincipal(extra);
  const sessionId = extractSessionId(extra);
  const ipHash = await extractIpHash();
  const userAgent = await extractUserAgent();
  const clientName = extractClientName(extra);
  const clientVersion = extractClientVersion(extra);

  return {
    principal,
    sessionId,
    ipHash,
    userAgent,
    clientName,
    clientVersion,
    startedAt: Date.now(),
  };
}

/**
 * Normalizes the raw args value (which is `unknown` from the SDK
 * callback signature) into the shape logToolCall accepts.
 *
 * Tools whose inputSchema is `{}` receive {} as args; we coerce to
 * null so the audit row stores null instead of an empty object.
 *
 * Used as the default when the tool does not provide an
 * auditArgsBuilder. For tools with large or sensitive arg payloads,
 * pass an explicit auditArgsBuilder instead.
 */
function rawArgsAsAuditPayload(
  rawArgs: unknown,
): Record<string, unknown> | null {
  if (rawArgs === null || rawArgs === undefined) return null;
  if (typeof rawArgs !== "object") return null;
  const asRecord = rawArgs as Record<string, unknown>;
  if (Object.keys(asRecord).length === 0) return null;
  return asRecord;
}

async function emitAudit(
  ctx: McpToolContext,
  toolName: McpToolName,
  args: Record<string, unknown> | null,
  resultStatus: NonNullable<McpHandlerResult["auditStatus"]>,
): Promise<void> {
  await logToolCall({
    principal: ctx.principal,
    sessionId: ctx.sessionId,
    toolName,
    args,
    resultStatus,
    latencyMs: Date.now() - ctx.startedAt,
    ipHash: ctx.ipHash,
    userAgent: ctx.userAgent,
    clientName: ctx.clientName,
    clientVersion: ctx.clientVersion,
  });
}
