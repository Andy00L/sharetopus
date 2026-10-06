import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { fetchSocialAccounts } from "@/actions/server/data/fetchSocialAccounts";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const ConnectionRowSchema = z.object({
  id: z.string(),
  platform: z.string(),
  name: z.string().nullable(),
  username: z.string().nullable(),
  status: z.enum(["ok", "needs_reconnect"]),
  follower_count: z.number().nullable().optional(),
  avatar_url: z.string().nullable().optional(),
});

const ListConnectionsOutputSchema = z.object({
  accounts: z.array(ConnectionRowSchema),
  reconnect_url: z.string(),
});

/** Lists every connected account; one in needs_reconnect status is fixed at reconnect_url. */
export function registerListConnections(server: McpServer): void {
  server.registerTool(
    "list_connections",
    {
      title: "List Connections",
      description:
        "List the connected social accounts with their id, platform and status. Use an id as social_account_id in publish_posts. An account in needs_reconnect status cannot publish until the user reconnects it at reconnect_url.",
      inputSchema: z.object({
        response_format: z
          .enum(["concise", "detailed"])
          .optional()
          .default("concise")
          .describe("detailed adds follower_count and avatar_url."),
      }),
      outputSchema: ListConnectionsOutputSchema,
      annotations: { title: "List Connections", readOnlyHint: true, openWorldHint: false },
    },
    withMcpTool(
      "list_connections",
      async (ctx, args: { response_format: "concise" | "detailed" }) => {
        const fetchResult = await fetchSocialAccounts(ctx.principal.principalId, "mcp", false);
        if (!fetchResult.success) {
          return errorResult(fetchResult.message);
        }

        const isDetailed = args.response_format === "detailed";
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
        return jsonResult({
          accounts: (fetchResult.data ?? []).map((account) => ({
            id: account.id,
            platform: account.platform,
            name: account.display_name,
            username: account.username,
            status: account.is_available ? ("ok" as const) : ("needs_reconnect" as const),
            ...(isDetailed
              ? { follower_count: account.follower_count, avatar_url: account.avatar_url }
              : {}),
          })),
          reconnect_url: `${baseUrl}/connections`,
        } satisfies z.infer<typeof ListConnectionsOutputSchema>);
      },
    ),
  );
}
