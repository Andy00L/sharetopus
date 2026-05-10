import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Returns the re-authentication URL for a social account whose token has expired.
 *
 * Plan gate: Starter+
 * Tables read: social_accounts
 *
 * We cannot initiate OAuth flows server-side, so this tool returns the
 * URL the user needs to visit in their browser to reconnect.
 * The agent should tell the user to open this link.
 */
export function registerRequestAccountReauthLink(server: McpServer): void {
  server.tool(
    "request_account_reauth_link",
    "Get a re-authentication link for a social account with an expired token. The user must open this link in their browser.",
    {
      social_account_id: z
        .string()
        .uuid()
        .describe("ID of the social account to re-authenticate"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      const ent = await entitlementFor(principal, "request_account_reauth_link");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "request_account_reauth_link",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      // Verify the account belongs to this principal
      const { data: account, error } = await adminSupabase
        .from("social_accounts")
        .select("id, platform, display_name, is_available")
        .eq("id", args.social_account_id)
        .eq("principal_id", principal.principalId)
        .single();

      if (error || !account) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "request_account_reauth_link",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [{ type: "text", text: "Social account not found or does not belong to you." }],
          isError: true,
        };
      }

      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "https://sharetopus.com";
      const reauthUrl = `${baseUrl}/connections`;

      await logToolCall({
        principal,
        sessionId,
        toolName: "request_account_reauth_link",
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
                account_id: account.id,
                platform: account.platform,
                display_name: account.display_name,
                is_available: account.is_available,
                reauth_url: reauthUrl,
                message: `Open the connections page to reconnect your ${account.platform} account: ${reauthUrl}`,
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
