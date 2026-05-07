import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { deleteScheduledPostBatchInternal } from "@/actions/server/_internal/scheduleActions/deleteScheduledPostBatch";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "./index";

/**
 * Permanently deletes scheduled posts and cleans up orphaned media.
 *
 * Plan gate: Starter+
 * Tables touched: scheduled_posts (read + delete), Supabase Storage (delete)
 * Calls: src/actions/server/_internal/scheduleActions/deleteScheduledPostBatch.ts
 *
 * The internal batch function now mirrors the web UI delete flow,
 * including storage cleanup for media files no longer referenced
 * by any remaining post.
 */
export function registerDeleteScheduledPosts(server: McpServer): void {
  server.tool(
    "delete_scheduled_posts",
    "Permanently delete one or more scheduled posts. This action cannot be undone.",
    {
      post_ids: z
        .array(z.string().uuid())
        .min(1)
        .max(50)
        .describe("Array of post IDs to delete"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "delete_scheduled_posts");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "delete_scheduled_posts",
          args,
          resultStatus: "denied",
          latencyMs: Date.now() - start,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      const result = await deleteScheduledPostBatchInternal(
        args.post_ids,
        principal.principalId
      );

      await logToolCall({
        principal,
        sessionId,
        toolName: "delete_scheduled_posts",
        args,
        resultStatus: result.success ? "ok" : "error",
        latencyMs: Date.now() - start,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: !result.success,
      };
    }
  );
}
