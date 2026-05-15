import "server-only";

import { headers } from "next/headers";

import { hashClientIp } from "@/lib/mcp/ipHash";

/**
 * Reads the client IP from request headers (x-forwarded-for first, then
 * x-real-ip), hashes it, and returns the hex digest. Returns null if no
 * IP header is present.
 *
 * Shared between MCP and REST. The previous home in
 * src/lib/mcp/context.ts now re-exports this as a deprecated shim.
 */
export async function extractIpHash(): Promise<string | null> {
  const headerList = await headers();
  const forwardedFor = headerList.get("x-forwarded-for");
  const realIp = headerList.get("x-real-ip");
  const candidateIp = forwardedFor
    ? forwardedFor.split(",")[0].trim()
    : (realIp ?? null);
  return hashClientIp(candidateIp);
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
