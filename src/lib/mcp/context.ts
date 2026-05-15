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
 * Extracts session ID from the extra context if available.
 *
 * Priority:
 *   1. SDK-provided sessionId (real for SSE, null for stateless Streamable HTTP)
 *   2. Synthetic per-request UUID stashed by withMcpAuth in stateless mode
 */
export function extractSessionId(
  extra: Record<string, unknown>,
): string | null {
  // SDK-provided session ID (populated when the transport supports sessions)
  const sdkSessionId =
    typeof extra.sessionId === "string" ? extra.sessionId : null;
  if (sdkSessionId) return sdkSessionId;

  // Synthetic per-request UUID from withMcpAuth (stateless Streamable HTTP)
  const authInfo = extra.authInfo as
    | { extra?: { requestSessionId?: unknown } }
    | undefined;
  const stashed = authInfo?.extra?.requestSessionId;
  return typeof stashed === "string" ? stashed : null;
}

/**
 * Extracts client_name from the extra context. Only present on initialize
 * requests; tool-call requests will return null (MCP protocol limitation).
 */
export function extractClientName(
  extra: Record<string, unknown>,
): string | null {
  const authInfo = extra.authInfo as
    | { extra?: { clientName?: unknown } }
    | undefined;
  const value = authInfo?.extra?.clientName;
  return typeof value === "string" ? value : null;
}

/**
 * Extracts client_version from the extra context. Only present on initialize
 * requests; tool-call requests will return null (MCP protocol limitation).
 */
export function extractClientVersion(
  extra: Record<string, unknown>,
): string | null {
  const authInfo = extra.authInfo as
    | { extra?: { clientVersion?: unknown } }
    | undefined;
  const value = authInfo?.extra?.clientVersion;
  return typeof value === "string" ? value : null;
}

/**
 * Extracts the per-request correlation ID. Same value as
 * extractSessionId in stateless mode (one synthetic UUID per request,
 * stashed by route.ts as requestSessionId), but exposed under a
 * separate name to reflect its purpose: log correlation across all
 * layers (route -> resolve -> HOF -> tool -> core actions -> Inngest).
 *
 * If mcp-handler later exposes real multi-call session lifecycle,
 * extractSessionId will return the SDK session ID while this stays
 * one-per-request. Keep them semantically distinct in callers.
 */
export function extractRequestId(
  extra: Record<string, unknown>,
): string | null {
  const authInfo = extra.authInfo as
    | { extra?: { requestSessionId?: unknown } }
    | undefined;
  const value = authInfo?.extra?.requestSessionId;
  return typeof value === "string" ? value : null;
}
