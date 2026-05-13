import { getScheduledPosts } from "@/actions/server/scheduleActions/getScheduledPosts";
import { extractPrincipal } from "@/lib/mcp/context";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { entitlementFor } from "../entitlement";

/**
 * MCP resource: scheduled posts.
 *
 * URI: mcp://sharetopus/scheduled-posts
 * Same data shape as the list_scheduled_posts tool, but exposed as a
 * resource so clients can cache and subscribe to updates.
 *
 * This resource and the list_scheduled_posts tool share the same plan gate.
 * If entitlement is denied the resource returns an empty contents array
 * with a reason in _meta, rather than throwing.
 *
 * Tables read: scheduled_posts, social_accounts
 */
export function registerScheduledPostsResource(server: McpServer): void {
  server.resource(
    "scheduled-posts",
    "mcp://sharetopus/scheduled-posts",
    {
      description: "Your scheduled posts across all platforms",
      mimeType: "application/json",
    },
    async (_uri, extra) => {
      const principal = extractPrincipal(extra);

      const ent = await entitlementFor(principal, "list_scheduled_posts");
      if (ent.mode === "deny") {
        return {
          contents: [],
          _meta: { reason: ent.reason },
        };
      }

      const result = await getScheduledPosts(principal.principalId, "mcp", {
        limit: 100,
      });

      return {
        contents: [
          {
            uri: "mcp://sharetopus/scheduled-posts",
            mimeType: "application/json",
            text: JSON.stringify(result.data ?? [], null, 2),
          },
        ],
      };
    },
  );
}
