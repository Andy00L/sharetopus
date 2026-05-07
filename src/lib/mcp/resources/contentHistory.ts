import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getContentHistoryInternal } from "@/actions/server/_internal/contentHistoryActions/getContentHistory";
import { extractPrincipal } from "@/lib/mcp/context";
import { entitlementFor } from "../entitlement";

/**
 * MCP resource: content history.
 *
 * URI: mcp://sharetopus/content-history
 * Read-only history of posts that have been published.
 *
 * This resource and the list_content_history tool share the same plan gate.
 * If entitlement is denied the resource returns an empty contents array
 * with a reason in _meta, rather than throwing.
 *
 * Tables read: content_history, social_accounts (join for avatar)
 */
export function registerContentHistoryResource(server: McpServer): void {
  server.resource(
    "content-history",
    "mcp://sharetopus/content-history",
    { description: "Your published content history", mimeType: "application/json" },
    async (_uri, extra) => {
      const principal = extractPrincipal(extra);

      const ent = await entitlementFor(principal, "list_content_history");
      if (ent.mode === "deny") {
        return {
          contents: [],
          _meta: { reason: ent.reason },
        };
      }

      const result = await getContentHistoryInternal(principal.principalId, {
        limit: 100,
      });

      return {
        contents: [
          {
            uri: "mcp://sharetopus/content-history",
            mimeType: "application/json",
            text: JSON.stringify(result.data ?? [], null, 2),
          },
        ],
      };
    }
  );
}
