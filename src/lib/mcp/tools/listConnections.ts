import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { fetchSocialAccountsInternal } from "@/actions/server/_internal/data/fetchSocialAccounts";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Lists the user's connected social accounts.
 *
 * Plan gate: any active subscription.
 * Tables read: social_accounts
 * Calls: src/actions/server/_internal/data/fetchSocialAccounts.ts
 *
 * Returns text/plain JSON so the output is never mistaken for free-form
 * text that the user authored.
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
    async ({ include_unavailable }, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      const ent = await entitlementFor(principal, "list_connections");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "list_connections",
          args: { include_unavailable },
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

      const result = await fetchSocialAccountsInternal(
        principal.principalId,
        !include_unavailable
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "list_connections",
        args: { include_unavailable },
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
      });

      if (!result.success) {
        return { content: [{ type: "text", text: result.message }], isError: true };
      }

      // Strip sensitive fields (tokens) before returning
      const safe = (result.data ?? []).map((a) => ({
        id: a.id,
        platform: a.platform,
        display_name: a.display_name,
        username: a.username,
        avatar_url: a.avatar_url,
        is_available: a.is_available,
        follower_count: a.follower_count,
      }));

      return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }] };
    }
  );
}
