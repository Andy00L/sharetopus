import "server-only";

/**
 * Source of truth for every MCP tool name. Importing this list (or the
 * derived McpToolName type) gives every callsite compile-time protection
 * against typos and missing entries.
 *
 * Add new tools here AND in src/lib/mcp/tools/index.ts. The TypeScript
 * compiler will then force you to update ACTION_PLAN_GATE,
 * MONTHLY_CAPS, and any other tool-keyed map.
 */
export const MCP_TOOL_NAMES = [
  // Read tools
  "list_connections",
  "list_pinterest_boards",
  "list_scheduled_posts",
  "list_content_history",
  "list_billing_summary",
  "request_account_reauth_link",
  // Write tools
  "attach_media_from_url",
  "request_upload_url",
  "schedule_post",
  "post_now",
  "cancel_scheduled_posts",
  "resume_scheduled_posts",
  "reschedule_posts",
  "delete_scheduled_posts",
  // Advanced
  "bulk_schedule",
  "bulk_post_now",
  "get_account_analytics",
  // AI
  "generate_post_draft",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
