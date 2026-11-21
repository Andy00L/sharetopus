import type { McpServer } from "@modelcontextprotocol/server";
import { registerPlanWeekForPlatform } from "./planWeekForPlatform";
import { registerRepurposePost } from "./repurposePost";
import { registerAuditCalendar } from "./auditCalendar";

export function registerPrompts(server: McpServer): void {
  registerPlanWeekForPlatform(server);
  registerRepurposePost(server);
  registerAuditCalendar(server);
}
