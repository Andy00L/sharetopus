import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import "server-only";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

/**
 * Lists the user's connected social accounts.
 *
 * Plan gate: free (any active subscription).
 * Tables read: social_accounts
 * Calls: src/actions/server/data/fetchSocialAccounts.ts
 *
 * Returns text/plain JSON so the output is never mistaken for free-form
 * text that the user authored. Tokens are stripped before serialization.
 */
export function registerListConnections(server: McpServer): void {
  server.registerTool(
    "list_connections",
    {
      title: "List Social Connections",
      description:
        "List your connected social accounts. Shows platform, display name, and availability status.",
      inputSchema: {
        include_unavailable: z
          .boolean()
          .optional()
          .default(false)
          .describe("Include accounts that are disconnected or expired"),
      },
      annotations: {
        title: "List Social Connections",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "list_connections",
      async (ctx, args: { include_unavailable: boolean }) => {
        const fetchResult = await fetchSocialAccounts(
          ctx.principal.principalId,
          "mcp",
          !args.include_unavailable,
        );

        if (!fetchResult.success) {
          return {
            content: [{ type: "text", text: fetchResult.message }],
            isError: true,
          };
        }

        const safeAccounts = (fetchResult.data ?? []).map((account) => ({
          id: account.id,
          platform: account.platform,
          display_name: account.display_name,
          username: account.username,
          avatar_url: account.avatar_url,
          is_available: account.is_available,
          follower_count: account.follower_count,
        }));

        return {
          content: [
            { type: "text", text: JSON.stringify(safeAccounts, null, 2) },
          ],
        };
      },
    ),
  );
}
