import "server-only";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { McpServer } from "@modelcontextprotocol/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type RequestAccountReauthLinkArgs = {
  social_account_id: string;
};

/**
 * Returns the re-authentication URL for a social account whose token
 * has expired.
 *
 * Plan gate: free (any active subscription).
 * Tables read: social_accounts.
 *
 * We cannot initiate OAuth flows server-side, so this tool returns the
 * URL the user needs to visit in their browser to reconnect. The agent
 * should tell the user to open this link.
 */
export function registerRequestAccountReauthLink(server: McpServer): void {
  server.registerTool(
    "request_account_reauth_link",
    {
      title: "Request Account Reauth Link",
      description:
        "Get a re-authentication link for a social account with an expired token. The user must open this link in their browser.",
      inputSchema: z.object({
        social_account_id: z
          .guid()
          .describe("ID of the social account to re-authenticate"),
      }),
      annotations: {
        title: "Request Account Reauth Link",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "request_account_reauth_link",
      async (ctx, args: RequestAccountReauthLinkArgs) => {
        const { data: socialAccounts, error: accountFetchError } =
          await runQuery(
            db
              .select({
                id: social_accounts.id,
                platform: social_accounts.platform,
                display_name: social_accounts.display_name,
                is_available: social_accounts.is_available,
              })
              .from(social_accounts)
              .where(
                and(
                  eq(social_accounts.id, args.social_account_id),
                  eq(social_accounts.principal_id, ctx.principal.principalId),
                ),
              )
              .limit(1),
          );

        // A failed read is not a missing account: telling the agent the
        // account does not exist would end the reconnect it came for.
        if (accountFetchError) {
          console.error(
            "[requestAccountReauthLink] Account fetch failed:",
            accountFetchError.message,
          );
          return {
            content: [
              {
                type: "text",
                text: "Could not load the social account. Please try again.",
              },
            ],
            isError: true,
          };
        }

        const socialAccount = socialAccounts[0];
        if (!socialAccount) {
          return {
            content: [
              {
                type: "text",
                text: "Social account not found or does not belong to you.",
              },
            ],
            isError: true,
          };
        }

        const baseUrl =
          process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
        const reauthUrl = `${baseUrl}/connections`;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  account_id: socialAccount.id,
                  platform: socialAccount.platform,
                  display_name: socialAccount.display_name,
                  is_available: socialAccount.is_available,
                  reauth_url: reauthUrl,
                  message: `Open the connections page to reconnect your ${socialAccount.platform} account: ${reauthUrl}`,
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
