/** Sent to every MCP client at initialize; the /docs/mcp page shows the same text. */
export const MCP_SERVER_INSTRUCTIONS = [
  "Sharetopus publishes and schedules posts on the user's connected social accounts.",
  "",
  "Posting takes two calls:",
  "1. list_connections: take each account's id (its platform and status come with it).",
  "2. publish_posts: one entry per account. Add scheduled_at (a future ISO 8601 time with a zone, e.g. 2026-10-08T10:00:00Z) to schedule a post; leave it out to publish now.",
  "Then list_posts with the returned batch_id shows what happened to each post.",
  "",
  "Media: attach_media_from_url copies a public image or video; request_upload_url gives a signed URL to PUT a local file. Both return storage_path, which is publish_posts' media_storage_path. One path can serve several posts.",
  "Targets: Pinterest needs pinterest_board_id (from list_pinterest_boards); reddit needs subreddit, lemmy community_id, gmb location_name; reddit, lemmy, devto, hashnode, medium, wordpress and dribbble need a title.",
  "An account in needs_reconnect status cannot publish until the user reconnects it at reconnect_url.",
  "update_scheduled_posts cancels, resumes or reschedules scheduled posts; delete_scheduled_posts removes them for good.",
  "TikTok posts made through this server are public.",
  "Limits: 30 posts per publish_posts call; list_billing_summary shows the monthly quotas.",
].join("\n");
