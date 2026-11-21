import type { McpServer } from "@modelcontextprotocol/server";

import { registerAttachMediaFromUrl } from "./attachMediaFromUrl";
import { registerDeleteScheduledPosts } from "./deleteScheduledPosts";
import { registerGetAccountAnalytics } from "./getAccountAnalytics";
import { registerListBillingSummary } from "./listBillingSummary";
import { registerListConnections } from "./listConnections";
import { registerListPinterestBoards } from "./listPinterestBoards";
import { registerListPosts } from "./listPosts";
import { registerPublishPosts } from "./publishPosts";
import { registerRequestUploadUrl } from "./requestUploadUrl";
import { registerUpdateScheduledPosts } from "./updateScheduledPosts";

const TOOL_REGISTRARS: ReadonlyArray<(server: McpServer) => void> = [
  registerListConnections,
  registerListPinterestBoards,
  registerListPosts,
  registerListBillingSummary,
  registerGetAccountAnalytics,
  registerAttachMediaFromUrl,
  registerRequestUploadUrl,
  registerPublishPosts,
  registerUpdateScheduledPosts,
  registerDeleteScheduledPosts,
];

export function registerTools(server: McpServer): void {
  for (const register of TOOL_REGISTRARS) {
    register(server);
  }
}
