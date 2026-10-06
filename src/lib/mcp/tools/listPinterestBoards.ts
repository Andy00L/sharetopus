import "server-only";

import type { McpServer } from "@modelcontextprotocol/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";

import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

type ListPinterestBoardsArgs = {
  social_account_id: string;
  page_size: number;
  bookmark?: string;
};

const ListPinterestBoardsOutputSchema = z.object({
  boards: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      privacy: z.string().optional(),
      pin_count: z.number().optional(),
    }),
  ),
  bookmark: z.string().nullable(),
});

/** Lists a Pinterest account's boards, one page at a time (bookmark cursor). */
export function registerListPinterestBoards(server: McpServer): void {
  server.registerTool(
    "list_pinterest_boards",
    {
      title: "List Pinterest Boards",
      description:
        "List the boards of a connected Pinterest account. A Pinterest post needs one board id as pinterest_board_id. Pass the returned bookmark to get the next page.",
      inputSchema: z.object({
        social_account_id: z.guid().describe("A Pinterest account id from list_connections."),
        page_size: z.number().int().min(1).max(100).optional().default(25),
        bookmark: z.string().optional(),
      }),
      outputSchema: ListPinterestBoardsOutputSchema,
      annotations: { title: "List Pinterest Boards", readOnlyHint: true, openWorldHint: true },
    },
    withMcpTool("list_pinterest_boards", async (ctx, args: ListPinterestBoardsArgs) => {
      const reconnectUrl = `${process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com"}/connections`;

      const { data: pinterestAccounts, error: accountFetchError } = await runQuery(
        db
          .select()
          .from(social_accounts)
          .where(
            and(
              eq(social_accounts.id, args.social_account_id),
              eq(social_accounts.principal_id, ctx.principal.principalId),
              eq(social_accounts.platform, "pinterest"),
              isNull(social_accounts.deleted_at),
            ),
          )
          .limit(1),
      );
      if (accountFetchError) {
        console.error(
          `[list_pinterest_boards] [req=${ctx.requestId ?? "?"}] Account fetch error:`,
          accountFetchError.message,
        );
        return errorResult("Could not look up the Pinterest account. Retry in a moment.");
      }

      const pinterestAccount = pinterestAccounts[0];
      if (!pinterestAccount) {
        return errorResult(
          "No Pinterest account with that id. Call list_connections for your Pinterest account ids.",
        );
      }

      const tokenRefreshResult = await ensureValidToken(pinterestAccount);
      if (!tokenRefreshResult.success || !tokenRefreshResult.token) {
        return errorResult(
          `This Pinterest account needs to be reconnected: ask the user to open ${reconnectUrl}.`,
        );
      }

      const boardsResult = await getPinterestBoards(
        tokenRefreshResult.token,
        ctx.principal.principalId,
        { pageSize: args.page_size, bookmark: args.bookmark },
      );
      if (!boardsResult.success) {
        switch (boardsResult.failure) {
          case "token_missing":
          case "token_expired":
            return errorResult(
              `Pinterest refused the account's token: ask the user to reconnect at ${reconnectUrl}.`,
            );
          case "rate_limited":
            return errorResult(
              `Too many Pinterest board requests. Retry in ${boardsResult.resetIn ?? 60} s.`,
              "rate_limited",
            );
          case "unavailable":
            return errorResult("Could not check the rate limit. Retry in a moment.");
          case "upstream_error":
            return errorResult("Pinterest did not answer. Retry in a moment.");
          default: {
            const unhandledFailure: never = boardsResult.failure;
            return errorResult(`Unexpected failure ${String(unhandledFailure)}.`);
          }
        }
      }

      return jsonResult({
        boards: boardsResult.boards,
        bookmark: boardsResult.bookmark,
      } satisfies z.infer<typeof ListPinterestBoardsOutputSchema>);
    }),
  );
}
