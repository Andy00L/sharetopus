import { headers } from "next/headers";
import type { McpPrincipal } from "./auth";
import { hashClientIp } from "./ipHash";

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
export function extractSessionId(extra: Record<string, unknown>): string | null {
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
 * Reads the client IP from request headers (x-forwarded-for first, then
 * x-real-ip), hashes it, and returns the hex digest. Returns null if no
 * IP header is present.
 */
export async function extractIpHash(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const real = h.get("x-real-ip");
  const raw = fwd ? fwd.split(",")[0].trim() : (real ?? null);
  return hashClientIp(raw);
}

/**
 * Reads User-Agent from request headers. Truncates to 512 chars to match
 * mcp_audit_log column behavior.
 */
export async function extractUserAgent(): Promise<string | null> {
  const h = await headers();
  const ua = h.get("user-agent");
  if (!ua) return null;
  return ua.length > 512 ? ua.slice(0, 512) : ua;
}
