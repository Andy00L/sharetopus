import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import type { SocialAccount } from "@/lib/types/dbTypes";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

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
      inputSchema: {
        social_account_id: z
          .string()
          .uuid()
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
      },
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
        const { data: pinterestAccount, error: accountFetchError } =
          await adminSupabase
            .from("social_accounts")
            .select(
              "id, platform, principal_id, access_token, refresh_token, token_expires_at",
            )
            .eq("id", args.social_account_id)
            .eq("principal_id", ctx.principal.principalId)
            .eq("platform", "pinterest")
            .is("deleted_at", null)
            .maybeSingle();

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
          const failureMessage = boardsResult.expired
            ? "Pinterest token is no longer valid. The user needs to reconnect."
            : "Failed to fetch Pinterest boards. Pinterest API may be unavailable.";

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    success: false,
                    message: failureMessage,
                    expired: boardsResult.expired ?? false,
                    ...(boardsResult.expired
                      ? { reauth_url: `${baseUrl}/connections` }
                      : {}),
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
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
                  bookmark: boardsResult.bookmark ?? null,
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
