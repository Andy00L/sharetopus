import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";

/**
 * `target_platforms` arrives as one comma-separated string: MCP prompt
 * arguments are always strings on the wire, so an array schema can never
 * match what a client sends. The schema splits the list and checks each
 * entry against POSTING_PLATFORMS before the handler runs.
 */
const targetPlatformsArgument = z
  .string()
  .describe(
    `Comma-separated target platforms, each one of ${POSTING_PLATFORMS.join(" / ")}.`,
  )
  .transform((platformList) =>
    platformList
      .split(",")
      .map((platformName) => platformName.trim().toLowerCase())
      .filter((platformName) => platformName.length > 0),
  )
  .pipe(z.array(z.enum(POSTING_PLATFORMS)).min(1));

/**
 * Prompt: repurpose an existing post for other platforms.
 *
 * Takes a post ID and target platforms. The agent should fetch the
 * original post via list_scheduled_posts or list_content_history,
 * then adapt it for each target platform.
 */
export function registerRepurposePost(server: McpServer): void {
  server.registerPrompt(
    "repurpose_post",
    {
      description:
        "Repurpose an existing post for other social platforms with platform-specific adaptations",
      argsSchema: z.object({
        post_id: z
          .string()
          .describe(
            "ID of the post to repurpose (from scheduled_posts or content_history)",
          ),
        target_platforms: targetPlatformsArgument,
      }),
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
