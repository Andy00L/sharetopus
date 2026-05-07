import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Prompt: repurpose an existing post for other platforms.
 *
 * Takes a post ID and target platforms. The agent should fetch the
 * original post via list_scheduled_posts or list_content_history,
 * then adapt it for each target platform.
 */
export function registerRepurposePost(server: McpServer): void {
  server.prompt(
    "repurpose_post",
    {
      post_id: z.string().describe("ID of the post to repurpose (from scheduled_posts or content_history)"),
      target_platforms: z
        .string()
        .describe("Comma-separated list of target platforms (e.g. 'linkedin,tiktok')"),
    },
    async ({ post_id, target_platforms }) => {
      const platforms = target_platforms
        .split(",")
        .map((p: string) => p.trim())
        .filter(Boolean);

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Repurpose post ${post_id} for these platforms: ${platforms.join(", ")}.`,
                "",
                "Steps:",
                "1. Use list_scheduled_posts or list_content_history to fetch the original post",
                "2. For each target platform, rewrite the content:",
                ...platforms.map(
                  (p: string) => `   - ${p}: adapt the tone, length, and hashtags for ${p}'s audience`
                ),
                "3. Show me the adapted versions for review",
                "4. For the ones I approve, schedule them using schedule_post or bulk_schedule",
                "",
                "Keep the core message the same, but make each version feel native to its platform.",
              ].join("\n"),
            },
          },
        ],
      };
    }
  );
}
