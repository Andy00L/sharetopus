import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";

import { selectLiveAvatarUrl } from "../_shared/liveAvatarUrl";
import { withMemoizedJsonSchema } from "../_shared/memoizedJsonSchema";
import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const ListConnectionsInputSchema = z.object({
  response_format: z
    .enum(["concise", "detailed"])
    .optional()
    .default("concise")
    .describe("detailed adds follower_count and avatar_url."),
});

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

const LIST_CONNECTIONS_TOOL = {
  title: "List Connections",
  description:
    "List the connected social accounts with their id, platform and status. Use an id as social_account_id in publish_posts. An account in needs_reconnect status cannot publish until the user reconnects it at reconnect_url.",
  inputSchema: withMemoizedJsonSchema(ListConnectionsInputSchema),
  outputSchema: withMemoizedJsonSchema(ListConnectionsOutputSchema),
  annotations: { title: "List Connections", readOnlyHint: true, openWorldHint: false },
};

const handleListConnections = withMcpTool(
  "list_connections",
  async (ctx, args: z.infer<typeof ListConnectionsInputSchema>) => {
    const { data: accountRows, error: accountsError } = await runQuery(
      db
        .select({
          id: social_accounts.id,
          platform: social_accounts.platform,
          display_name: social_accounts.display_name,
          username: social_accounts.username,
          is_available: social_accounts.is_available,
          follower_count: social_accounts.follower_count,
          avatar_url: social_accounts.avatar_url,
        })
        .from(social_accounts)
        .where(
          and(
            eq(social_accounts.principal_id, ctx.principal.principalId),
            isNull(social_accounts.deleted_at),
          ),
        ),
    );
    if (accountsError) {
      console.error(
        `[list_connections] [req=${ctx.requestId ?? "?"}] Accounts read failed:`,
        accountsError.message,
      );
      return errorResult("Could not load your connected accounts. Retry in a moment.");
    }

    const isDetailed = args.response_format === "detailed";
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
    const nowMs = Date.now();
    return jsonResult({
      accounts: accountRows.map((account) => ({
        id: account.id,
        platform: account.platform,
        name: account.display_name,
        username: account.username,
        status: account.is_available ? ("ok" as const) : ("needs_reconnect" as const),
        ...(isDetailed
          ? {
              follower_count: account.follower_count,
              avatar_url: selectLiveAvatarUrl(account.avatar_url, nowMs),
            }
          : {}),
      })),
      reconnect_url: `${baseUrl}/connections`,
    } satisfies z.infer<typeof ListConnectionsOutputSchema>);
  },
);

export function registerListConnections(server: McpServer): void {
  server.registerTool("list_connections", LIST_CONNECTIONS_TOOL, handleListConnections);
}
