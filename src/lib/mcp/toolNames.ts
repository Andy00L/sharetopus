import "server-only";

/** Every MCP tool name; tool-keyed maps (entitlement.ts) must cover each one. */
export const MCP_TOOL_NAMES = [
  "list_connections",
  "list_pinterest_boards",
  "list_posts",
  "list_billing_summary",
  "get_account_analytics",
  "attach_media_from_url",
  "request_upload_url",
  "publish_posts",
  "update_scheduled_posts",
  "delete_scheduled_posts",
] as const;

export type McpToolName = (typeof MCP_TOOL_NAMES)[number];
