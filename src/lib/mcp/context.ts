import type { McpPrincipal } from "./auth";

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
 * Extracts session ID from the extra context if available.
 */
export function extractSessionId(extra: Record<string, unknown>): string | null {
  const sessionId = (extra.sessionId as string) ?? null;
  return sessionId;
}
