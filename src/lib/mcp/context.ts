import type { AuthInfo } from "@modelcontextprotocol/server";

import type { McpPrincipal } from "./auth/types";

/**
 * Narrows the principal the route stashed in `authInfo.extra.principal`.
 * The route builds that object itself, so a shallow check is enough.
 */
function isMcpPrincipal(value: unknown): value is McpPrincipal {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("principalId" in value)) return false;
  return (
    (value.kind === "apikey" || value.kind === "oauth") &&
    typeof value.principalId === "string"
  );
}

/**
 * Returns the McpPrincipal the route resolved for this request.
 *
 * withMcpAuth (src/app/api/mcp/mcp/route.ts) returns an AuthInfo whose
 * `extra.principal` holds it; the SDK hands that AuthInfo to every tool
 * callback as `ctx.http?.authInfo`.
 *
 * Called by: withMcpTool (src/lib/mcp/withMcpTool.ts)
 */
export function extractPrincipal(authInfo: AuthInfo | undefined): McpPrincipal {
  const principal = authInfo?.extra?.principal;
  if (!isMcpPrincipal(principal)) {
    throw new Error("No principal found in MCP auth context. This is a bug.");
  }
  return principal;
}

/**
 * Extracts the per-request correlation ID, one synthetic UUID per request
 * stashed by the route as `authInfo.extra.requestId`. It ties together the
 * log lines of every layer (route -> resolve -> HOF -> tool -> core actions
 * -> Inngest) and fills mcp_audit_log.session_id, since the stateless
 * transport has no longer-lived session.
 */
export function extractRequestId(authInfo: AuthInfo | undefined): string | null {
  const requestId = authInfo?.extra?.requestId;
  return typeof requestId === "string" ? requestId : null;
}
