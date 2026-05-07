import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchSocialAccountsInternal } from "@/actions/server/_internal/data/fetchSocialAccounts";
import { extractPrincipal } from "../tools/index";
import { entitlementFor } from "../entitlement";

/**
 * MCP resource: connected social accounts.
 *
 * URI: mcp://sharetopus/connections
 * Lists the user's social accounts with platform, display name, and status.
 * Sensitive fields (tokens) are stripped.
 *
 * This resource and the list_connections tool share the same plan gate.
 * If entitlement is denied the resource returns an empty contents array
 * with a reason in _meta, rather than throwing.
 *
 * Tables read: social_accounts
 */
export function registerConnectionsResource(server: McpServer): void {
  server.resource(
    "connections",
    "mcp://sharetopus/connections",
    { description: "Your connected social media accounts", mimeType: "application/json" },
    async (_uri, extra) => {
      const principal = extractPrincipal(extra);

      const ent = await entitlementFor(principal, "list_connections");
      if (ent.mode === "deny") {
        return {
          contents: [],
          _meta: { reason: ent.reason },
        };
      }

      const result = await fetchSocialAccountsInternal(principal.principalId, false);

      const safe = (result.data ?? []).map((a) => ({
        id: a.id,
        platform: a.platform,
        display_name: a.display_name,
        username: a.username,
        avatar_url: a.avatar_url,
        is_available: a.is_available,
        follower_count: a.follower_count,
      }));

      return {
        contents: [
          {
            uri: "mcp://sharetopus/connections",
            mimeType: "application/json",
            text: JSON.stringify(safe, null, 2),
          },
        ],
      };
    }
  );
}
