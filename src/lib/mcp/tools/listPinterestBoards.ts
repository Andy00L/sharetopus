import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { ensureValidToken } from "@/lib/api/ensureValidToken";
import { getPinterestBoards } from "@/lib/api/pinterest/data/getPinterestBoards";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import {
  extractPrincipal,
  extractSessionId,
  extractIpHash,
  extractUserAgent,
} from "@/lib/mcp/context";
import type { SocialAccount } from "@/lib/types/dbTypes";

/**
 * Lists Pinterest boards for a connected Pinterest account.
 *
 * Plan gate: any active subscription (read-only, free tier).
 * Tables read: social_accounts
 * External call: GET https://api.pinterest.com/v5/boards (via getPinterestBoards)
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
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      // 1. Entitlement check
      const ent = await entitlementFor(principal, "list_pinterest_boards");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_pinterest_boards",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            { type: "text", text: `Denied: ${ent.detail ?? ent.reason}` },
          ],
          isError: true,
        };
      }

      // 2. Resolve the account, scoped to principal + platform=pinterest
      const { data: account, error: accErr } = await adminSupabase
        .from("social_accounts")
        .select(
          "id, platform, principal_id, access_token, refresh_token, token_expires_at"
        )
        .eq("id", args.social_account_id)
        .eq("principal_id", principal.principalId)
        .eq("platform", "pinterest")
        .is("deleted_at", null)
        .maybeSingle();

      if (accErr) {
        console.error(
          "[mcp/list_pinterest_boards] Account fetch error:",
          accErr.message
        );
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_pinterest_boards",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            { type: "text", text: "Failed to look up the Pinterest account." },
          ],
          isError: true,
        };
      }

      if (!account) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_pinterest_boards",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
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

      // 3. Ensure the token is fresh (refresh if expired)
      const tokenResult = await ensureValidToken(account as SocialAccount);
      if (!tokenResult.success || !tokenResult.token) {
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_pinterest_boards",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  message:
                    tokenResult.error ??
                    "Pinterest token cannot be refreshed. User must reconnect.",
                  reauth_url: `${baseUrl}/connections`,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      // 4. Call the shared helper
      const result = await getPinterestBoards(
        tokenResult.token,
        principal.principalId,
        { pageSize: args.page_size, bookmark: args.bookmark }
      );

      // 5. Translate result into MCP response
      if (!result.success) {
        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";

        await logToolCall({
          principal,
          sessionId,
          toolName: "list_pinterest_boards",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });

        const message = result.expired
          ? "Pinterest token is no longer valid. The user needs to reconnect."
          : "Failed to fetch Pinterest boards. Pinterest API may be unavailable.";

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: false,
                  message,
                  expired: result.expired ?? false,
                  ...(result.expired
                    ? { reauth_url: `${baseUrl}/connections` }
                    : {}),
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_pinterest_boards",
        args,
        resultStatus: "ok",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                boards: result.boards,
                bookmark: result.bookmark ?? null,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
