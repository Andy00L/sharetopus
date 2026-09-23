import "server-only";

/**
 * The MCP rate limits, shared by the code that enforces them and the docs
 * that publish them, so the two cannot disagree. They live here because a
 * Next.js route file may only export route fields.
 *
 * Read by: src/app/api/mcp/mcp/route.ts (per-IP flood guard),
 *          src/lib/mcp/withMcpTool.ts (per-user tool-call budget),
 *          src/lib/docs/buildMcpDocMarkdown.ts and
 *          src/app/(marketing)/(api-reference)/docs/mcp/data/sections.ts (docs)
 */

/**
 * Per-IP ceiling on the MCP endpoint, in requests per window (seconds),
 * checked before any token work so floods and token probing stay cheap to
 * refuse. Hosted clients (Claude, ChatGPT) send every user's calls from a
 * shared pool of egress IPs, so this is a flood guard, not a per-user budget.
 */
export const MCP_ROUTE_RATE_LIMIT = { requests: 1000, windowSeconds: 60 } as const;

/**
 * Tool calls one principal may make per window (seconds), across all tools:
 * about 10x a busy agent. Keyed on the principal, not the IP, for the same
 * shared-egress reason.
 */
export const MCP_TOOL_CALL_RATE_LIMIT = { calls: 100, windowSeconds: 60 } as const;
