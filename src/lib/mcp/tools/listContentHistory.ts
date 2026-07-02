import "server-only";

import { getContentHistory } from "@/actions/server/contentHistoryActions/getContentHistory";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import { Platform } from "@/lib/types/database.types";
import { withMcpTool } from "../withMcpTool";

type ListContentHistoryArgs = {
  platform?: Platform;
  limit: number;
};

/**
 * Lists content that has already been posted.
 *
 * Plan gate: free (any active subscription).
 * Tables read: content_history, social_accounts (join for avatar_url).
 * Calls: src/actions/server/contentHistoryActions/getContentHistory.ts
 *
 * Output is JSON.stringify. No free-form user text.
 */
export function registerListContentHistory(server: McpServer): void {
  server.registerTool(
    "list_content_history",
    {
      title: "List Content History",
      description:
        "View your posted content history. Optional filter by platform.",
      inputSchema: {
        platform: z
          .enum(POSTING_PLATFORMS)
          .optional()
          .describe("Filter by platform"),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .default(20)
          .describe("Max results to return (1-100)"),
      },
      annotations: {
        title: "List Content History",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "list_content_history",
      async (ctx, args: ListContentHistoryArgs) => {
        const historyResult = await getContentHistory(
          ctx.principal.principalId,
          "mcp",
          args,
        );

        if (!historyResult.success) {
          return {
            content: [{ type: "text", text: historyResult.message }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(historyResult.data ?? [], null, 2),
            },
          ],
        };
      },
    ),
  );
}
