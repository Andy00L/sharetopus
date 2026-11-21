import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { SCHEDULABLE_PLATFORMS } from "@/lib/platforms/capabilities";

// MCP prompt arguments are strings on the wire: prompts/get params.arguments is a string-to-string record
// (@modelcontextprotocol/server GetPromptRequest schema).
const targetPlatformsArgument = z
  .string()
  .describe(
    `Comma-separated target platforms, each one of ${SCHEDULABLE_PLATFORMS.join(" / ")}.`,
  )
  .transform((platformList) =>
    platformList
      .split(",")
      .map((platformName) => platformName.trim().toLowerCase())
      .filter((platformName) => platformName.length > 0),
  )
  .pipe(z.array(z.enum(SCHEDULABLE_PLATFORMS)).min(1));

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
            "Id of the post to repurpose, from list_posts.",
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
              "1. Find the original post in list_posts (response_format detailed; try status published, then upcoming)",
              "2. For each target platform, rewrite the content:",
              ...target_platforms.map(
                (platform) =>
                  `   - ${platform}: adapt the tone, length, and hashtags for ${platform}'s audience`,
              ),
              "3. Show me the adapted versions for review",
              "4. Publish or schedule the ones I approve in one publish_posts call",
              "",
              "Keep the core message the same, but make each version feel native to its platform.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
