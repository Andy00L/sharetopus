import type { McpPrincipal } from "./auth/types";

/**
 * Helper to extract the McpPrincipal from the tool handler's extra context.
 *
 * mcp-handler injects the AuthInfo (from withMcpAuth) into the second argument
 * of tool callbacks as `extra.authInfo`. We stash the McpPrincipal inside
 * `authInfo.extra.principal` in the route handler.
 *
 * Called by: every tool and resource handler in this directory
 */
export function extractPrincipal(extra: Record<string, unknown>): McpPrincipal {
  const authInfo = extra.authInfo as
    | { extra?: { principal?: McpPrincipal } }
    | undefined;
  const principal = authInfo?.extra?.principal;
  if (!principal) {
    throw new Error("No principal found in MCP auth context. This is a bug.");
  }
  return principal;
}

/**
 * Extracts the per-request correlation ID, one synthetic UUID per request
 * stashed by the route (src/app/api/mcp/[transport]/route.ts) as
 * `authInfo.extra.requestId`. It ties together the log lines of every
 * layer (route -> resolve -> HOF -> tool -> core actions -> Inngest) and
 * fills mcp_audit_log.session_id, since the stateless transport has no
 * longer-lived session.
 */
export function extractRequestId(
  extra: Record<string, unknown>,
): string | null {
  const authInfo = extra.authInfo as
    | { extra?: { requestId?: unknown } }
    | undefined;
  const value = authInfo?.extra?.requestId;
  return typeof value === "string" ? value : null;
}
