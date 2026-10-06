import "server-only";

import { MCP_TOOL_NAMES, type McpToolName } from "@/lib/mcp/toolNames";
import { SITE_ORIGIN } from "./markdownPrimitives";

// Shared by the /docs/mcp page and its markdown twin (/docs/mcp.md), so the two cannot drift.

export const MCP_ENDPOINTS = {
  // sourceRef: src/app/api/mcp/mcp/route.ts (the only MCP route),
  //            docs/MCP.md (transport URL)
  streamableHttp: `${SITE_ORIGIN}/api/mcp/mcp`,
} as const;

export type McpToolGroup = "Read tools" | "Media tools" | "Posting tools";

export interface McpToolDocEntry {
  group: McpToolGroup;
  summary: string;
}

/** One line per tool, keyed by McpToolName so a new tool cannot ship undocumented. */
export const MCP_TOOL_DOCS: Record<McpToolName, McpToolDocEntry> = {
  list_connections: {
    group: "Read tools",
    summary:
      "Your connected accounts with id, platform and status; an account in needs_reconnect status is fixed at reconnect_url.",
  },
  list_pinterest_boards: {
    group: "Read tools",
    summary: "The boards of a Pinterest account, paged with a bookmark cursor.",
  },
  list_posts: {
    group: "Read tools",
    summary:
      "Posts by status (upcoming, published, failed, cancelled), or every post of one publish_posts call by batch_id.",
  },
  list_billing_summary: {
    group: "Read tools",
    summary: "Your plan, its status, and this month's calls of each capped tool against its limit.",
  },
  get_account_analytics: {
    group: "Read tools",
    summary: "Daily views, likes, comments, shares and subscribers for your content; up to 24 hours old.",
  },
  attach_media_from_url: {
    group: "Media tools",
    summary: "Copies an image or video from a public URL into storage and returns its storage_path.",
  },
  request_upload_url: {
    group: "Media tools",
    summary: "A signed URL to PUT a local image or video; returns the storage_path to post it.",
  },
  publish_posts: {
    group: "Posting tools",
    summary:
      "Publishes or schedules 1 to 30 posts in one call: scheduled_at schedules a post, no scheduled_at publishes it now.",
  },
  update_scheduled_posts: {
    group: "Posting tools",
    summary: "Cancels, resumes or reschedules up to 50 scheduled posts.",
  },
  delete_scheduled_posts: {
    group: "Posting tools",
    summary: "Permanently deletes up to 50 scheduled posts.",
  },
};

export const MCP_TOOL_GROUP_ORDER: readonly McpToolGroup[] = [
  "Read tools",
  "Media tools",
  "Posting tools",
];

/** The tools of one group, in MCP_TOOL_NAMES order. */
export function listMcpToolsInGroup(
  group: McpToolGroup,
): { name: McpToolName; summary: string }[] {
  return MCP_TOOL_NAMES.filter(
    (toolName) => MCP_TOOL_DOCS[toolName].group === group,
  ).map((toolName) => ({
    name: toolName,
    summary: MCP_TOOL_DOCS[toolName].summary,
  }));
}

/** The registered prompt templates (src/lib/mcp/prompts). */
export const MCP_PROMPT_DOCS: readonly { name: string; summary: string }[] = [
  {
    name: "plan_week_for_platform",
    summary:
      "Plan a full week of content for a specific social platform around a chosen theme.",
  },
  {
    name: "repurpose_post",
    summary:
      "Repurpose an existing post for other social platforms with platform-specific adaptations.",
  },
  {
    name: "audit_calendar",
    summary:
      "Review your next 14 days of scheduled posts. Checks for gaps, clustering, and platform balance.",
  },
];

// Client setup shared by the docs pages and McpDocsCard. sourceRef: claude.com/docs/connectors/custom/remote-mcp, code.claude.com/docs/en/mcp

/** Claude's default OAuth option works because Clerk publishes client ID metadata documents; dynamic registration is off. */
export const MCP_CLAUDE_CONNECT_STEPS =
  "Open Customize > Connectors > Add custom connector, paste the URL, and click Add. Then click Connect and sign in to Sharetopus.";

/** What follows the Claude Code add command: OAuth sign-in, or an API key. */
export const MCP_CLAUDE_CODE_NEXT_STEP =
  'Then run /mcp and choose Authenticate. With an API key, add --header "Authorization: Bearer stp_mcp_YOUR_KEY" to the command instead.';

/** Alt text of the mcp-two-calls film poster (public/films), shown on /docs/mcp and in McpDocsCard. */
export const MCP_TWO_CALLS_FILM_ALT =
  "Film: an agent posts in two MCP calls, list_connections then publish_posts, and checks the result with list_posts.";

/** The Claude Code command that adds the server over Streamable HTTP. */
export function buildClaudeCodeAddCommand(endpointUrl: string): string {
  return `claude mcp add --transport http sharetopus ${endpointUrl}`;
}

/** The Cursor configuration block (~/.cursor/mcp.json) for an API key. */
export function buildMcpClientConfigJson(endpointUrl: string): string {
  return `{
  "mcpServers": {
    "sharetopus": {
      "url": "${endpointUrl}",
      "headers": {
        "Authorization": "Bearer stp_mcp_YOUR_KEY"
      }
    }
  }
}`;
}
