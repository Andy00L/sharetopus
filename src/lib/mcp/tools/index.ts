import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerListConnections } from "./listConnections";
import { registerListScheduledPosts } from "./listScheduledPosts";
import { registerListContentHistory } from "./listContentHistory";
import { registerSchedulePost } from "./schedulePost";
import { registerPostNow } from "./postNow";
import { registerBulkSchedule } from "./bulkSchedule";
import { registerCancelScheduledPosts } from "./cancelScheduledPosts";
import { registerResumeScheduledPosts } from "./resumeScheduledPosts";
import { registerReschedulePosts } from "./reschedulePosts";
import { registerDeleteScheduledPosts } from "./deleteScheduledPosts";
import { registerGetAccountAnalytics } from "./getAccountAnalytics";
import { registerGeneratePostDraft } from "./generatePostDraft";
import { registerAttachMediaFromUrl } from "./attachMediaFromUrl";
import { registerRequestUploadUrl } from "./requestUploadUrl";
import { registerRequestAccountReauthLink } from "./requestAccountReauthLink";
import { registerListBillingSummary } from "./listBillingSummary";

/**
 * Registers all 16 MCP tool handlers on the server instance.
 *
 * Each tool file exports a register function that calls server.tool()
 * with the tool name, schema, and handler callback.
 *
 * Called by: src/app/api/mcp/[transport]/route.ts
 */
export function registerTools(server: McpServer): void {
  registerListConnections(server);
  registerListScheduledPosts(server);
  registerListContentHistory(server);
  registerSchedulePost(server);
  registerPostNow(server);
  registerBulkSchedule(server);
  registerCancelScheduledPosts(server);
  registerResumeScheduledPosts(server);
  registerReschedulePosts(server);
  registerDeleteScheduledPosts(server);
  registerGetAccountAnalytics(server);
  registerGeneratePostDraft(server);
  registerAttachMediaFromUrl(server);
  registerRequestUploadUrl(server);
  registerRequestAccountReauthLink(server);
  registerListBillingSummary(server);
}
