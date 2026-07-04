import "server-only";

import { MCP_TOOL_NAMES, type McpToolName } from "@/lib/mcp/toolNames";
import { SITE_ORIGIN } from "./markdownPrimitives";

/**
 * Shared catalog behind the two MCP doc surfaces: the markdown twin
 * (buildMcpDocMarkdown.ts, served at /docs/mcp.md) and the HTML
 * reference page (src/app/(marketing)/(api-reference)/docs/mcp). One
 * source so the surfaces cannot drift.
 */

export const MCP_ENDPOINTS = {
  // sourceRef: src/app/api/mcp/[transport]/route.ts (basePath "/api/mcp"),
  //            docs/MCP.md (transport URLs)
  streamableHttp: `${SITE_ORIGIN}/api/mcp/mcp`,
  sse: `${SITE_ORIGIN}/api/mcp/sse`,
} as const;

/**
 * Per-IP rate limit on the MCP endpoint.
 * sourceRef: src/app/api/mcp/[transport]/route.ts
 * (MCP_ROUTE_RATE_LIMIT_REQUESTS / _WINDOW_SECONDS)
 */
export const MCP_RATE_LIMIT = { requests: 100, windowSeconds: 60 } as const;

export type McpToolGroup =
  | "Read tools"
  | "Write tools"
  | "Advanced tools"
  | "AI tools";

export interface McpToolDocEntry {
  group: McpToolGroup;
  summary: string;
}

/**
 * One-line documentation per MCP tool, keyed by McpToolName so the
 * compiler forces both doc surfaces to be updated whenever a tool is
 * added to MCP_TOOL_NAMES. Summaries mirror the description strings
 * passed to registerTool in each handler; groups mirror the
 * toolNames.ts comments.
 * sourceRef: src/lib/mcp/tools/<toolFile>.ts (description fields),
 *            src/lib/mcp/toolNames.ts (grouping)
 */
export const MCP_TOOL_DOCS: Record<McpToolName, McpToolDocEntry> = {
  list_connections: {
    group: "Read tools",
    summary:
      "List your connected social accounts with platform, display name, and availability status.",
  },
  list_pinterest_boards: {
    group: "Read tools",
    summary:
      "List Pinterest boards for a connected Pinterest account, with pagination via the bookmark cursor.",
  },
  list_scheduled_posts: {
    group: "Read tools",
    summary: "List your scheduled posts, with optional platform or status filter.",
  },
  list_content_history: {
    group: "Read tools",
    summary: "View your posted content history, with optional platform filter.",
  },
  list_billing_summary: {
    group: "Read tools",
    summary:
      "View your current subscription plan, status, and monthly usage quota counts.",
  },
  request_account_reauth_link: {
    group: "Read tools",
    summary:
      "Get a re-authentication link for a social account with an expired token. The user opens it in a browser.",
  },
  attach_media_from_url: {
    group: "Write tools",
    summary:
      "Download media from a public URL into Sharetopus storage. Returns a storage path for posting tools.",
  },
  request_upload_url: {
    group: "Write tools",
    summary:
      "Get a signed URL for uploading media directly to Sharetopus storage.",
  },
  schedule_post: {
    group: "Write tools",
    summary:
      "Schedule one post for a future time. Upload media first; use list_connections to find account ids.",
  },
  post_now: {
    group: "Write tools",
    summary:
      "Publish one post to one platform immediately. Returns an event id; confirm via list_content_history after 30 to 60 seconds.",
  },
  cancel_scheduled_posts: {
    group: "Write tools",
    summary:
      "Cancel scheduled posts. Only posts with status scheduled can be cancelled.",
  },
  resume_scheduled_posts: {
    group: "Write tools",
    summary:
      "Resume cancelled posts. Past-dated posts are rescheduled to one hour from now.",
  },
  reschedule_posts: {
    group: "Write tools",
    summary:
      "Change the scheduled time of up to 50 posts. Cancelled posts are resumed by the move.",
  },
  delete_scheduled_posts: {
    group: "Write tools",
    summary: "Permanently delete scheduled posts. Not reversible.",
  },
  bulk_schedule: {
    group: "Advanced tools",
    summary:
      "Schedule up to 30 posts in one call, for cross-posting or a content series. Supply batch_id to make retries safe.",
  },
  bulk_post_now: {
    group: "Advanced tools",
    summary:
      "Publish up to 30 posts immediately across platforms and accounts, reusing one media upload.",
  },
  get_account_analytics: {
    group: "Advanced tools",
    summary:
      "Fetch performance metrics (views, likes, comments, shares) for your content. Data may lag up to 24 hours.",
  },
  generate_post_draft: {
    group: "AI tools",
    summary:
      "Generate a draft post using the connected client's own LLM, at no Sharetopus inference cost.",
  },
};

export const MCP_TOOL_GROUP_ORDER: readonly McpToolGroup[] = [
  "Read tools",
  "Write tools",
  "Advanced tools",
  "AI tools",
];

/**
 * Lists the tools of one group in the canonical MCP_TOOL_NAMES order.
 */
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

/**
 * Prompt templates registered on the server, with their registered
 * names and description strings.
 * sourceRef: src/lib/mcp/prompts/planWeekForPlatform.ts,
 *            repurposePost.ts, auditCalendar.ts
 */
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

/**
 * The Claude Desktop / Cursor configuration block, shared verbatim by
 * both doc surfaces. sourceRef: docs/MCP.md (client configuration)
 */
export const MCP_CLIENT_CONFIG_JSON = `{
  "mcpServers": {
    "sharetopus": {
      "url": "${MCP_ENDPOINTS.streamableHttp}",
      "headers": {
        "Authorization": "Bearer stp_mcp_YOUR_KEY"
      }
    }
  }
}`;
