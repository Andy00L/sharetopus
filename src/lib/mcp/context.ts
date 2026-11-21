import type { AuthInfo } from "@modelcontextprotocol/server";

import type { McpPrincipal } from "./auth/types";

function isMcpPrincipal(value: unknown): value is McpPrincipal {
  if (typeof value !== "object" || value === null) return false;
  if (!("kind" in value) || !("principalId" in value)) return false;
  return (
    (value.kind === "apikey" || value.kind === "oauth") &&
    typeof value.principalId === "string"
  );
}

export function extractPrincipal(authInfo: AuthInfo | undefined): McpPrincipal {
  const principal = authInfo?.extra?.principal;
  if (!isMcpPrincipal(principal)) {
    throw new Error("No principal found in MCP auth context. This is a bug.");
  }
  return principal;
}

export function extractRequestId(authInfo: AuthInfo | undefined): string | null {
  const requestId = authInfo?.extra?.requestId;
  return typeof requestId === "string" ? requestId : null;
}
