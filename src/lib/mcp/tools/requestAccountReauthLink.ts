import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
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
      inputSchema: {
        social_account_id: z
          .string()
          .uuid()
          .describe("ID of the social account to re-authenticate"),
      },
      annotations: {
        title: "Request Account Reauth Link",
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "request_account_reauth_link",
      async (ctx, args: RequestAccountReauthLinkArgs) => {
        const { data: socialAccount, error: accountFetchError } =
          await adminSupabase
            .from("social_accounts")
            .select("id, platform, display_name, is_available")
            .eq("id", args.social_account_id)
            .eq("principal_id", ctx.principal.principalId)
            .single();

        if (accountFetchError || !socialAccount) {
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
