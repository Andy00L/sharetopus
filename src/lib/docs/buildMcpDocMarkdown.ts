import "server-only";

import {
  MCP_ROUTE_RATE_LIMIT,
  MCP_TOOL_CALL_RATE_LIMIT,
} from "@/lib/mcp/rateLimits";
import { MCP_SERVER_INSTRUCTIONS } from "@/lib/mcp/serverInstructions";
import { MCP_TOOL_NAMES } from "@/lib/mcp/toolNames";
import {
  MCP_CLAUDE_CODE_NEXT_STEP,
  MCP_CLAUDE_CONNECT_STEPS,
  MCP_ENDPOINTS,
  MCP_PROMPT_DOCS,
  MCP_TOOL_GROUP_ORDER,
  buildClaudeCodeAddCommand,
  buildMcpClientConfigJson,
  listMcpToolsInGroup,
} from "./mcpCatalog";
import { SITE_ORIGIN } from "./markdownPrimitives";

function renderToolGroups(): string {
  return MCP_TOOL_GROUP_ORDER.map((group) => {
    const groupLines = listMcpToolsInGroup(group).map(
      (tool) => `- **${tool.name}**: ${tool.summary}`,
    );
    return [`### ${group}`, "", ...groupLines].join("\n");
  }).join("\n\n");
}

/** The MCP guide as markdown for agents, served at /docs/mcp.md; content shared with the HTML page. */
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
    "",
    "Stateless. Clients on MCP protocol 2026-07-28 and on the 2025 revisions use the same URL; the legacy SSE transport is not served.",
    "",
    "## Authentication",
    "",
    `1. **API key**: send \`Authorization: Bearer stp_mcp_...\`. Create the key in the Sharetopus web app at ${SITE_ORIGIN}/integrations (shown once, up to 10 active keys).`,
    "2. **OAuth 2.1**: OAuth-capable clients discover the auth server automatically via the RFC 9728 metadata endpoint at `/.well-known/oauth-protected-resource` and identify themselves with a client ID metadata document. No key needed.",
    "",
    "## Plan requirement and limits",
    "",
    "- Every tool requires the Creator plan or higher.",
    `- Tool calls: ${MCP_TOOL_CALL_RATE_LIMIT.calls} per ${MCP_TOOL_CALL_RATE_LIMIT.windowSeconds} seconds per user, across all tools. A call over the budget returns a tool error with the retry delay.`,
    `- Requests: ${MCP_ROUTE_RATE_LIMIT.requests} per ${MCP_ROUTE_RATE_LIMIT.windowSeconds} seconds per IP. Above that the endpoint answers HTTP 429 with a Retry-After header.`,
    "- Some tools carry monthly quotas that scale with the plan tier; exceeding one returns an error naming the quota.",
    "",
    "## Client configuration",
    "",
    `**Claude (web and desktop)**: ${MCP_CLAUDE_CONNECT_STEPS}`,
    "",
    "**Claude Code**",
    "",
    "```bash",
    buildClaudeCodeAddCommand(MCP_ENDPOINTS.streamableHttp),
    "```",
    "",
    MCP_CLAUDE_CODE_NEXT_STEP,
    "",
    "**Cursor, with an API key** (`~/.cursor/mcp.json`)",
    "",
    "```json",
    buildMcpClientConfigJson(MCP_ENDPOINTS.streamableHttp),
    "```",
    "",
    "**Other clients**: a client that signs in with a client ID metadata document needs only the URL; the sign-in flow starts automatically. A client that only supports dynamic client registration uses an API key instead.",
    "",
    `## Tools (${MCP_TOOL_NAMES.length})`,
    "",
    renderToolGroups(),
    "",
    `## Prompts (${MCP_PROMPT_DOCS.length})`,
    "",
    ...promptLines,
    "",
    "## Server instructions",
    "",
    "Every client receives this guide when it connects:",
    "",
    "```text",
    MCP_SERVER_INSTRUCTIONS,
    "```",
    "",
    `The site index for agents is ${SITE_ORIGIN}/llms.txt. The REST alternative (API key, no MCP client needed) is documented at ${SITE_ORIGIN}/docs/quickstart.md.`,
  ];
  return `${lines.join("\n")}\n`;
}
