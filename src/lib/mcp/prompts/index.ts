import type { McpServer } from "@modelcontextprotocol/server";
import { registerPlanWeekForPlatform } from "./planWeekForPlatform";
import { registerRepurposePost } from "./repurposePost";
import { registerAuditCalendar } from "./auditCalendar";

/**
 * Registers all MCP prompt templates on the server.
 *
 * Prompts are reusable message templates the user can invoke from
 * the client's prompt picker. They return structured messages that
 * guide the agent through a workflow.
 *
 * Called by: src/app/api/mcp/mcp/route.ts
 */
export function registerPrompts(server: McpServer): void {
  registerPlanWeekForPlatform(server);
  registerRepurposePost(server);
  registerAuditCalendar(server);
}
