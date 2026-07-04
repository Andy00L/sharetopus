import "server-only";

import { MCP_TOOL_NAMES, type McpToolName } from "@/lib/mcp/toolNames";
import { SITE_ORIGIN } from "./markdownPrimitives";

/**
 * Renders the MCP server guide as plain markdown for AI agents.
 * Served at /docs/mcp.md via /api/docs/[slug].
 */

type McpToolGroup = "Read tools" | "Write tools" | "Advanced tools" | "AI tools";

interface McpToolDocEntry {
  group: McpToolGroup;
  summary: string;
}

/**
 * One-line documentation per MCP tool, keyed by McpToolName so the
 * compiler forces this doc to be updated whenever a tool is added to
 * MCP_TOOL_NAMES. Summaries mirror the description strings passed to
 * registerTool in each handler; groups mirror the toolNames.ts comments.
 * sourceRef: src/lib/mcp/tools/<toolFile>.ts (description fields),
 *            src/lib/mcp/toolNames.ts (grouping)
 */
const MCP_TOOL_DOCS: Record<McpToolName, McpToolDocEntry> = {
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

const MCP_TOOL_GROUP_ORDER: readonly McpToolGroup[] = [
  "Read tools",
  "Write tools",
  "Advanced tools",
  "AI tools",
];

/**
 * Prompt templates registered on the server, with their registered
 * names and description strings.
 * sourceRef: src/lib/mcp/prompts/planWeekForPlatform.ts,
 *            repurposePost.ts, auditCalendar.ts
 */
const MCP_PROMPT_DOCS: readonly { name: string; summary: string }[] = [
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

function renderToolGroups(): string {
  return MCP_TOOL_GROUP_ORDER.map((group) => {
    const groupLines = MCP_TOOL_NAMES.filter(
      (toolName) => MCP_TOOL_DOCS[toolName].group === group,
    ).map(
      (toolName) => `- **${toolName}**: ${MCP_TOOL_DOCS[toolName].summary}`,
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
    `- Streamable HTTP: \`${SITE_ORIGIN}/api/mcp/mcp\``,
    `- SSE: \`${SITE_ORIGIN}/api/mcp/sse\``,
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
    "- Per-IP rate limit on the endpoint: 100 requests per 60 seconds.",
    "- Some tools carry monthly quotas that scale with the plan tier; exceeding one returns an error naming the quota.",
    "",
    "## Client configuration",
    "",
    "**Claude Desktop or Cursor, with an API key**",
    "",
    "```json",
    "{",
    '  "mcpServers": {',
    '    "sharetopus": {',
    `      "url": "${SITE_ORIGIN}/api/mcp/mcp",`,
    '      "headers": {',
    '        "Authorization": "Bearer stp_mcp_YOUR_KEY"',
    "      }",
    "    }",
    "  }",
    "}",
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
