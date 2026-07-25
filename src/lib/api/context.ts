import "server-only";

import { headers } from "next/headers";

import { hashClientIp } from "@/lib/mcp/ipHash";
import { resolveClientIp } from "@/lib/net/clientIp";

/**
 * Reads the client IP from the proxy headers, hashes it, and returns the
 * hex digest. Returns null if no IP header is present.
 *
 * Resolution is delegated to lib/net/clientIp so the value hashed into
 * mcp_audit_log / rest_audit_log / x402_access_log is the same one the
 * rate limiter buckets on, and so neither can be steered by a
 * caller-supplied x-forwarded-for entry.
 *
 * Shared between MCP and REST. The previous home in
 * src/lib/mcp/context.ts now re-exports this as a deprecated shim.
 */
export async function extractIpHash(): Promise<string | null> {
  return hashClientIp(resolveClientIp(await headers()));
}

/**
 * Reads User-Agent from request headers. Truncates to 512 chars to match
 * audit log column behavior. Returns null when absent.
 *
 * Shared between MCP and REST. The previous home in
 * src/lib/mcp/context.ts now re-exports this as a deprecated shim.
 */
export async function extractUserAgent(): Promise<string | null> {
  const headerList = await headers();
  const rawUserAgent = headerList.get("user-agent");
  if (!rawUserAgent) return null;
  return rawUserAgent.length > 512 ? rawUserAgent.slice(0, 512) : rawUserAgent;
}
