import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerAttachMediaFromUrl } from "./attachMediaFromUrl";
import { registerBulkPostNow } from "./bulkPostNow";
import { registerBulkSchedule } from "./bulkSchedule";
import { registerCancelScheduledPosts } from "./cancelScheduledPosts";
import { registerDeleteScheduledPosts } from "./deleteScheduledPosts";
import { registerGeneratePostDraft } from "./generatePostDraft";
import { registerGetAccountAnalytics } from "./getAccountAnalytics";
import { registerListBillingSummary } from "./listBillingSummary";
import { registerListConnections } from "./listConnections";
import { registerListContentHistory } from "./listContentHistory";
import { registerListPinterestBoards } from "./listPinterestBoards";
import { registerListScheduledPosts } from "./listScheduledPosts";
import { registerPostNow } from "./postNow";
import { registerRequestAccountReauthLink } from "./requestAccountReauthLink";
import { registerRequestUploadUrl } from "./requestUploadUrl";
import { registerReschedulePosts } from "./reschedulePosts";
import { registerResumeScheduledPosts } from "./resumeScheduledPosts";
import { registerSchedulePost } from "./schedulePost";

/**
 * Registers every MCP tool on the server instance. Adding a tool means:
 *   1. Add its name to MCP_TOOL_NAMES in src/lib/mcp/toolNames.ts
 *   2. Add an entry to ACTION_PLAN_GATE (and MONTHLY_CAPS if it has one)
 *   3. Create the register* file and add it to the array below
 *
 * The compiler will surface step 2 misses as type errors thanks to the
 * Record<McpToolName, ...> typing in entitlement.ts.
 */
const TOOL_REGISTRARS: ReadonlyArray<(server: McpServer) => void> = [
  registerListConnections,
  registerListPinterestBoards,
  registerListScheduledPosts,
  registerListContentHistory,
  registerListBillingSummary,
  registerRequestAccountReauthLink,
  registerAttachMediaFromUrl,
  registerRequestUploadUrl,
  registerSchedulePost,
  registerPostNow,
  registerCancelScheduledPosts,
  registerResumeScheduledPosts,
  registerReschedulePosts,
  registerDeleteScheduledPosts,
  registerBulkSchedule,
  registerBulkPostNow,
  registerGetAccountAnalytics,
  registerGeneratePostDraft,
];

export function registerTools(server: McpServer): void {
  for (const register of TOOL_REGISTRARS) {
    register(server);
  }
}
