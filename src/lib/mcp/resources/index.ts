import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerConnectionsResource } from "./connections";
import { registerScheduledPostsResource } from "./scheduledPosts";

/**
 * Registers all MCP resource handlers on the server.
 *
 * Resources advertise read-only context the agent can subscribe to.
 * The client may cache these locally. Unlike tools, resources are
 * not gated by entitlement checks because they only expose data
 * the user already has access to.
 *
 * Called by: src/app/api/mcp/[transport]/route.ts
 */
export function registerResources(server: McpServer): void {
  registerScheduledPostsResource(server);
  registerConnectionsResource(server);
}
