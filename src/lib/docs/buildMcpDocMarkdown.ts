import "server-only";

import { MCP_TOOL_NAMES } from "@/lib/mcp/toolNames";
import {
  MCP_CLIENT_CONFIG_JSON,
  MCP_ENDPOINTS,
  MCP_PROMPT_DOCS,
  MCP_RATE_LIMIT,
  MCP_TOOL_GROUP_ORDER,
  listMcpToolsInGroup,
} from "./mcpCatalog";
import { SITE_ORIGIN } from "./markdownPrimitives";

/**
 * Renders the MCP server guide as plain markdown for AI agents.
 * Served at /docs/mcp.md via /api/docs/[slug]. Content comes from the
 * shared catalog (mcpCatalog.ts), the same source the HTML reference
 * page reads, so the two surfaces cannot drift.
 */

function renderToolGroups(): string {
  return MCP_TOOL_GROUP_ORDER.map((group) => {
    const groupLines = listMcpToolsInGroup(group).map(
      (tool) => `- **${tool.name}**: ${tool.summary}`,
    );
    return [`### ${group}`, "", ...groupLines].join("\n");
  }).join("\n\n");
}

export async function buildMcpDocMarkdown(): Promise<string> {
  const promptLines = MCP_PROMPT_DOCS.map(
    (promptDoc) => `- **${promptDoc.name}**: ${promptDoc.summary}`,
  );
  const lines = [
    "# Sharetopus MCP Server",
    "",
    "> Manage social media posts from any MCP client (Claude Desktop, Cursor, ChatGPT, and others): connect accounts, upload media, publish or schedule posts, and read analytics on behalf of an authenticated Sharetopus subscriber.",
    "",
    "## Connection",
    "",
    `- Streamable HTTP: \`${MCP_ENDPOINTS.streamableHttp}\``,
    `- SSE: \`${MCP_ENDPOINTS.sse}\``,
    "",
    "Both transports are stateless: no persistent sessions.",
    "",
    "## Authentication",
    "",
    `1. **API key**: send \`Authorization: Bearer stp_mcp_...\`. Create the key in the Sharetopus web app at ${SITE_ORIGIN}/integrations (shown once, up to 10 active keys).`,
    "2. **OAuth 2.1**: OAuth-capable clients discover the auth server automatically via the RFC 9728 metadata endpoint at `/.well-known/oauth-protected-resource` and sign in with dynamic client registration. No key needed.",
    "",
    "## Plan requirement and limits",
    "",
    "- Every tool requires the Creator plan or higher.",
    `- Per-IP rate limit on the endpoint: ${MCP_RATE_LIMIT.requests} requests per ${MCP_RATE_LIMIT.windowSeconds} seconds.`,
    "- Some tools carry monthly quotas that scale with the plan tier; exceeding one returns an error naming the quota.",
    "",
    "## Client configuration",
    "",
    "**Claude Desktop or Cursor, with an API key**",
    "",
    "```json",
    MCP_CLIENT_CONFIG_JSON,
    "```",
    "",
    "**OAuth-capable clients**: configure only the URL; the sign-in flow starts automatically.",
    "",
    `## Tools (${MCP_TOOL_NAMES.length})`,
    "",
    renderToolGroups(),
    "",
    `## Prompts (${MCP_PROMPT_DOCS.length})`,
    "",
    ...promptLines,
    "",
    "## Typical flow",
    "",
    "1. `list_connections` to find the social account ids and their availability.",
    "2. `attach_media_from_url` (or `request_upload_url`) when the post carries an image or video.",
    "3. `schedule_post` or `post_now` with the account id and the storage path.",
    "4. `list_scheduled_posts` or `list_content_history` to confirm the result.",
    "",
    `The site index for agents is ${SITE_ORIGIN}/llms.txt. The REST alternative (API key, no MCP client needed) is documented at ${SITE_ORIGIN}/docs/quickstart.md.`,
  ];
  return `${lines.join("\n")}\n`;
}
