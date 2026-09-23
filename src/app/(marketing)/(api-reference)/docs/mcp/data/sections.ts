import type { DocsSection } from "@/lib/docs/apiReferenceTypes";
import {
  MCP_CLAUDE_CODE_NEXT_STEP,
  MCP_CLAUDE_CONNECT_STEPS,
  MCP_ENDPOINTS,
  MCP_PROMPT_DOCS,
  MCP_TOOL_GROUP_ORDER,
  buildClaudeCodeAddCommand,
  buildMcpClientConfigJson,
  listMcpToolsInGroup,
  type McpToolGroup,
} from "@/lib/docs/mcpCatalog";
import {
  MCP_ROUTE_RATE_LIMIT,
  MCP_TOOL_CALL_RATE_LIMIT,
} from "@/lib/mcp/rateLimits";
import { MCP_TOOL_NAMES } from "@/lib/mcp/toolNames";

/**
 * Content model for the public /docs/mcp reference page. Tool and prompt
 * rows come from the shared MCP catalog (src/lib/docs/mcpCatalog.ts), the
 * same source the markdown twin /docs/mcp.md renders, so the two surfaces
 * cannot drift. Prose facts carry sourceRefs like the x402 data file.
 */

export const MCP_OVERVIEW = {
  title: "MCP Server Reference",
  subtitle:
    "Manage social media posts from any MCP client (Claude Desktop, Cursor, ChatGPT, and others): connect accounts, upload media, publish or schedule posts, and read analytics on behalf of an authenticated Sharetopus subscriber.",
  planNote:
    "MCP access requires the Creator plan or higher; every tool is gated at that tier.",
} as const;

const TOOL_GROUP_SECTION_IDS: Record<McpToolGroup, string> = {
  "Read tools": "tools-read",
  "Write tools": "tools-write",
  "Advanced tools": "tools-advanced",
  "AI tools": "tools-ai",
};

function buildToolGroupSection(group: McpToolGroup): DocsSection {
  const tools = listMcpToolsInGroup(group);
  return {
    id: TOOL_GROUP_SECTION_IDS[group],
    navLabel: group,
    title: group,
    summary: `${tools.length} of the server's ${MCP_TOOL_NAMES.length} tools.`,
    sourceRef: "src/lib/docs/mcpCatalog.ts (MCP_TOOL_DOCS)",
    table: {
      columns: ["Tool", "What it does"],
      rows: tools.map((tool) => [tool.name, tool.summary]),
    },
  };
}

export const MCP_DOCS_SECTIONS: DocsSection[] = [
  {
    id: "connection",
    navLabel: "Connection",
    title: "Connection",
    summary:
      "Streamable HTTP, stateless. Clients on MCP protocol 2026-07-28 and on the 2025 revisions use the same URL; the legacy SSE transport is not served.",
    sourceRef: "src/lib/docs/mcpCatalog.ts (MCP_ENDPOINTS), docs/MCP.md",
    table: {
      columns: ["Transport", "URL"],
      rows: [["Streamable HTTP", MCP_ENDPOINTS.streamableHttp]],
    },
  },
  {
    id: "authentication",
    navLabel: "Authentication",
    title: "Authentication",
    summary:
      "Two independent paths resolve to the same authenticated principal. Pick the one your client supports.",
    sourceRef: "src/lib/mcp/README.md (auth paths), docs/MCP.md",
    table: {
      columns: ["Method", "How it works"],
      rows: [
        [
          "API key",
          "Send Authorization: Bearer stp_mcp_... on every request. Create the key at /integrations (shown once, up to 10 active keys, revocable from the UI).",
        ],
        [
          "OAuth 2.1",
          "OAuth-capable clients discover the auth server automatically via the RFC 9728 metadata endpoint at /.well-known/oauth-protected-resource and sign in with dynamic client registration. No key needed.",
        ],
      ],
    },
  },
  {
    id: "plan-limits",
    navLabel: "Plan and limits",
    title: "Plan requirement and limits",
    summary: "What gates a tool call before any business logic runs.",
    sourceRef:
      "src/lib/mcp/entitlement.ts (ACTION_PLAN_GATE), src/lib/mcp/rateLimits.ts",
    table: {
      columns: ["Constraint", "Value"],
      rows: [
        ["Plan requirement", "Creator plan or higher, for every tool"],
        [
          "Tool calls",
          `${MCP_TOOL_CALL_RATE_LIMIT.calls} per ${MCP_TOOL_CALL_RATE_LIMIT.windowSeconds} seconds per user, across all tools; a call over the budget returns a tool error with the retry delay`,
        ],
        [
          "Requests",
          `${MCP_ROUTE_RATE_LIMIT.requests} per ${MCP_ROUTE_RATE_LIMIT.windowSeconds} seconds per IP; above that the endpoint answers HTTP 429 with Retry-After`,
        ],
        [
          "Monthly quotas",
          "Some tools carry monthly caps that scale with the plan tier; exceeding one returns an error naming the quota",
        ],
      ],
    },
  },
  {
    id: "client-config",
    navLabel: "Client configuration",
    title: "Client configuration",
    summary:
      "Claude and other OAuth-capable clients need only the URL and a sign-in. API-key clients send the key as a bearer token.",
    sourceRef: "src/lib/docs/mcpCatalog.ts (client setup)",
    table: {
      columns: ["Client", "How to connect"],
      rows: [
        ["Claude (web and desktop)", MCP_CLAUDE_CONNECT_STEPS],
        ["Claude Code", `Run the command below. ${MCP_CLAUDE_CODE_NEXT_STEP}`],
        [
          "Cursor",
          "Add the JSON below to ~/.cursor/mcp.json, with a key created at /integrations.",
        ],
        [
          "Other clients",
          "OAuth-capable clients need only the URL; the sign-in flow starts automatically. The rest send Authorization: Bearer stp_mcp_... on every request.",
        ],
      ],
    },
    codeSamples: [
      {
        label: "Claude Code · OAuth",
        code: buildClaudeCodeAddCommand(MCP_ENDPOINTS.streamableHttp),
      },
      {
        label: "Cursor · API key",
        code: buildMcpClientConfigJson(MCP_ENDPOINTS.streamableHttp),
        // featured: this page's single signature stamp card
        // (placement rule in docs/UI_DESIGN_SYSTEM.md).
        featured: true,
      },
    ],
  },
  ...MCP_TOOL_GROUP_ORDER.map(buildToolGroupSection),
  {
    id: "prompts",
    navLabel: "Prompts",
    title: `Prompts (${MCP_PROMPT_DOCS.length})`,
    summary:
      "Reusable message templates invocable from the client's prompt picker; each returns structured messages that guide the agent through a workflow.",
    sourceRef: "src/lib/docs/mcpCatalog.ts (MCP_PROMPT_DOCS)",
    table: {
      columns: ["Prompt", "What it does"],
      rows: MCP_PROMPT_DOCS.map((promptDoc) => [
        promptDoc.name,
        promptDoc.summary,
      ]),
    },
  },
  {
    id: "typical-flow",
    navLabel: "Typical flow",
    title: "Typical flow",
    summary: "The four-step path from a fresh session to a confirmed post.",
    sourceRef: "src/lib/docs/buildMcpDocMarkdown.ts (typical flow)",
    table: {
      columns: ["Step", "Tool", "Purpose"],
      rows: [
        ["1", "list_connections", "Find social account ids and availability"],
        [
          "2",
          "attach_media_from_url",
          "Upload media when the post carries an image or video (or request_upload_url)",
        ],
        [
          "3",
          "schedule_post",
          "Schedule (or post_now to publish immediately) with the account id and storage path",
        ],
        [
          "4",
          "list_scheduled_posts",
          "Confirm the result (or list_content_history for published posts)",
        ],
      ],
    },
  },
];

export const MCP_SIDEBAR_ITEMS = [
  { id: "overview", label: "Overview" },
  ...MCP_DOCS_SECTIONS.map((section) => ({
    id: section.id,
    label: section.navLabel,
  })),
];
