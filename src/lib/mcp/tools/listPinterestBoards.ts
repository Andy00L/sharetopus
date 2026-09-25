import "server-only";

import { and, eq, isNull } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import type { SocialAccount } from "@/lib/types/dbTypes";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type ListPinterestBoardsArgs = {
  social_account_id: string;
  page_size: number;
  bookmark?: string;
};

/**
 * Lists Pinterest boards for a connected Pinterest account.
 *
 * Plan gate: free (read-only).
 * Tables read: social_accounts.
 * External call: GET https://api.pinterest.com/v5/boards (via getPinterestBoards).
 *
 * Token refresh is delegated to ensureValidToken so this tool never
 * runs Pinterest's auth flow itself. If the refresh fails, the tool
 * returns a reauth_url so the agent can ask the user to reconnect.
 *
 * Pagination: pass `bookmark` from the previous response to fetch the
 * next page. Page size defaults to 25 (Pinterest default), max 100.
 */
export function registerListPinterestBoards(server: McpServer): void {
  server.registerTool(
    "list_pinterest_boards",
    {
      title: "List Pinterest Boards",
      description:
        "List Pinterest boards for a connected Pinterest account. Returns board id, name, description, privacy, and pin_count. Supports pagination via the bookmark cursor.",
      inputSchema: z.object({
        social_account_id: z
          .guid()
          .describe("ID of the Pinterest social_accounts row"),
        page_size: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(25)
          .describe("Number of boards to return per page (1-100, default 25)"),
        bookmark: z
          .string()
          .optional()
          .describe("Pagination cursor from a previous response"),
      }),
      annotations: {
        title: "List Pinterest Boards",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "list_pinterest_boards",
      async (ctx, args: ListPinterestBoardsArgs) => {
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";

        // 1. Resolve the account, scoped to principal + platform=pinterest.
        const { data: pinterestAccounts, error: accountFetchError } =
          await runQuery(
            db
              .select({
                id: social_accounts.id,
                platform: social_accounts.platform,
                principal_id: social_accounts.principal_id,
                access_token: social_accounts.access_token,
                refresh_token: social_accounts.refresh_token,
                token_expires_at: social_accounts.token_expires_at,
              })
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
            `[mcp/list_pinterest_boards] [req=${ctx.requestId ?? "?"}] Account fetch error:`,
            accountFetchError.message,
          );
          return {
            content: [
              {
                type: "text",
                text: "Failed to look up the Pinterest account.",
              },
            ],
            isError: true,
          };
        }

        const pinterestAccount = pinterestAccounts[0];
        if (!pinterestAccount) {
          return {
            content: [
              {
                type: "text",
                text: "Pinterest account not found for this principal. Use list_connections to see your connected accounts.",
              },
            ],
            isError: true,
          };
        }

        // 2. Ensure the token is fresh (refresh if expired).
        const tokenRefreshResult = await ensureValidToken(
          pinterestAccount as SocialAccount,
        );
        if (!tokenRefreshResult.success || !tokenRefreshResult.token) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    message:
                      tokenRefreshResult.error ??
                      "Pinterest token cannot be refreshed. User must reconnect.",
                    reauth_url: `${baseUrl}/connections`,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }

        // 3. Call the shared helper.
        const boardsResult = await getPinterestBoards(
          tokenRefreshResult.token,
          ctx.principal.principalId,
          { pageSize: args.page_size, bookmark: args.bookmark },
        );

        if (!boardsResult.success) {
          const isExpired = boardsResult.failure === "token_expired";
          const failureMessage = isExpired
            ? "Pinterest token is no longer valid. The user needs to reconnect."
            : boardsResult.failure === "rate_limited"
              ? `Too many Pinterest board requests. Retry in ${boardsResult.resetIn ?? 60} s.`
              : boardsResult.failure === "unavailable"
                ? "Could not check the rate limit. Please try again."
                : "Failed to fetch Pinterest boards. Pinterest API may be unavailable.";

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    message: failureMessage,
                    expired: isExpired,
                    ...(isExpired
                      ? { reauth_url: `${baseUrl}/connections` }
                      : {}),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
            auditStatus:
              boardsResult.failure === "rate_limited" ? "rate_limited" : "error",
          };
        }

        // 4. Success.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  boards: boardsResult.boards,
                  bookmark: boardsResult.bookmark,
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );
}
