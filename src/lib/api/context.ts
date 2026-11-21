import "server-only";

import { headers } from "next/headers";

import { hashClientIp } from "@/lib/mcp/ipHash";
import { resolveClientIp } from "@/lib/net/clientIp";

const USER_AGENT_MAX_CHARS = 512;

export async function extractIpHash(): Promise<string | null> {
  return hashClientIp(resolveClientIp(await headers()));
}

export async function extractUserAgent(): Promise<string | null> {
  const headerList = await headers();
  const rawUserAgent = headerList.get("user-agent");
  if (!rawUserAgent) return null;
  return rawUserAgent.slice(0, USER_AGENT_MAX_CHARS);
}
