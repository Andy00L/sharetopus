import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
/**
 * Prompt: repurpose an existing post for other platforms.
 *
 * Takes a post ID and target platforms. The agent should fetch the
 * original post via list_scheduled_posts or list_content_history,
 * then adapt it for each target platform.
 *
 * `target_platforms` is a typed enum array so the client picker can
 * render a multi-select dropdown and the server rejects typos before
 * the handler runs.
 */
export function registerRepurposePost(server: McpServer): void {
  server.prompt(
    "repurpose_post",
    "Repurpose an existing post for other social platforms with platform-specific adaptations",
    {
      post_id: z
        .string()
        .describe(
          "ID of the post to repurpose (from scheduled_posts or content_history)",
        ),
      target_platforms: z
        .array(z.enum(POSTING_PLATFORMS))
        .min(1)
        .describe(
          `Target platforms to repurpose for. Each entry must be one of ${POSTING_PLATFORMS.join(" / ")}.`,
        ),
    },
    async ({ post_id, target_platforms }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Repurpose post ${post_id} for these platforms: ${target_platforms.join(", ")}.`,
              "",
              "Steps:",
              "1. Use list_scheduled_posts or list_content_history to fetch the original post",
              "2. For each target platform, rewrite the content:",
              ...target_platforms.map(
                (platform) =>
                  `   - ${platform}: adapt the tone, length, and hashtags for ${platform}'s audience`,
              ),
              "3. Show me the adapted versions for review",
              "4. For the ones I approve, schedule them using schedule_post or bulk_schedule",
              "",
              "Keep the core message the same, but make each version feel native to its platform.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
