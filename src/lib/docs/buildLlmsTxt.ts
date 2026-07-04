import "server-only";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import { SITE_ORIGIN } from "./markdownPrimitives";

/**
 * Renders /llms.txt, the machine-readable site index for AI agents
 * (llmstxt.org format): what Sharetopus does, which integration
 * surface to pick, and where the markdown docs live.
 */
export function buildLlmsTxt(): string {
  const platformList = POSTING_PLATFORMS.join(", ");
  const lines = [
    "# Sharetopus",
    "",
    `> Social media scheduling for humans and AI agents. Sharetopus posts and schedules text, image, and video content to ${platformList}. Agents can use three surfaces: a REST API (API key), an MCP server, and an x402 API where each request is paid in USDC with no account and no API key.`,
    "",
    "Facts agents need up front:",
    "",
    `- REST API base URL: ${SITE_ORIGIN}/api/v1. Auth: \`Authorization: Bearer stp_rest_...\`, key created at ${SITE_ORIGIN}/integrations.`,
    `- MCP endpoint: ${SITE_ORIGIN}/api/mcp/mcp (streamable HTTP) or ${SITE_ORIGIN}/api/mcp/sse (SSE). Auth: \`stp_mcp_...\` API key or OAuth 2.1. Requires the Creator plan or higher.`,
    `- x402 base URL: ${SITE_ORIGIN}/api/x402. No account: each call is paid in USDC on base, polygon, arbitrum, or solana, and the wallet signature identifies the caller.`,
    "",
    "## Docs",
    "",
    `- [x402 API reference](${SITE_ORIGIN}/docs/x402.md): payment flow, every pay-per-action endpoint, live pricing, error codes, rate limits`,
    `- [MCP server guide](${SITE_ORIGIN}/docs/mcp.md): connection URLs, authentication, all tools and prompts, plan requirements`,
    `- [REST quickstart](${SITE_ORIGIN}/docs/quickstart.md): schedule a first post in five minutes`,
    `- [REST authentication](${SITE_ORIGIN}/docs/authentication.md): API keys and security practices`,
    `- [Webhooks](${SITE_ORIGIN}/docs/webhooks.md): HMAC-signed event notifications for post lifecycle events`,
    `- [OpenAPI 3.1 spec](${SITE_ORIGIN}/api/v1/openapi.json): the full REST API surface, machine readable`,
    "",
    "## Optional",
    "",
    `- [Interactive REST explorer](${SITE_ORIGIN}/docs/api): human-facing viewer over the same OpenAPI spec`,
    `- [x402 reference, HTML](${SITE_ORIGIN}/docs/x402): human-facing version of the x402 doc`,
  ];
  return `${lines.join("\n")}\n`;
}
