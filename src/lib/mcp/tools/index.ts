import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpPrincipal } from "../auth";

import { registerListConnections } from "./listConnections";
import { registerListScheduledPosts } from "./listScheduledPosts";
import { registerListContentHistory } from "./listContentHistory";
import { registerSchedulePost } from "./schedulePost";
import { registerBulkSchedule } from "./bulkSchedule";
import { registerCancelScheduledPosts } from "./cancelScheduledPosts";
import { registerResumeScheduledPosts } from "./resumeScheduledPosts";
import { registerReschedulePosts } from "./reschedulePosts";
import { registerDeleteScheduledPosts } from "./deleteScheduledPosts";
import { registerGetAccountAnalytics } from "./getAccountAnalytics";
import { registerGeneratePostDraft } from "./generatePostDraft";
import { registerAttachMediaFromUrl } from "./attachMediaFromUrl";
import { registerRequestAccountReauthLink } from "./requestAccountReauthLink";
import { registerListBillingSummary } from "./listBillingSummary";

/**
 * Helper to extract the McpPrincipal from the tool handler's extra context.
 *
 * mcp-handler injects the AuthInfo (from withMcpAuth) into the second argument
 * of tool callbacks as `extra.authInfo`. We stash the McpPrincipal inside
 * `authInfo.extra.principal` in the route handler.
 *
 * Called by: every tool handler in this directory
 */
export function extractPrincipal(extra: Record<string, unknown>): McpPrincipal {
  const authInfo = extra.authInfo as
    | { extra?: { principal?: McpPrincipal } }
    | undefined;
  const principal = authInfo?.extra?.principal;
  if (!principal) {
    throw new Error("No principal found in MCP auth context. This is a bug.");
  }
  return principal;
}

/**
 * Extracts session ID from the extra context if available.
 */
export function extractSessionId(extra: Record<string, unknown>): string | null {
  const sessionId = (extra.sessionId as string) ?? null;
  return sessionId;
}

/**
 * Registers all 14 MCP tool handlers on the server instance.
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
  registerBulkSchedule(server);
  registerCancelScheduledPosts(server);
  registerResumeScheduledPosts(server);
  registerReschedulePosts(server);
  registerDeleteScheduledPosts(server);
  registerGetAccountAnalytics(server);
  registerGeneratePostDraft(server);
  registerAttachMediaFromUrl(server);
  registerRequestAccountReauthLink(server);
  registerListBillingSummary(server);
}
