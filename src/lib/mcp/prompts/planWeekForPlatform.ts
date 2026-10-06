import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { SCHEDULABLE_PLATFORMS } from "@/lib/platforms/capabilities";

/** Prompt: plan 5 to 7 posts for one platform around a theme. */
export function registerPlanWeekForPlatform(server: McpServer): void {
  server.registerPrompt(
    "plan_week_for_platform",
    {
      description:
        "Plan a full week of content for a specific social platform around a chosen theme",
      argsSchema: z.object({
        platform: z
          .enum(SCHEDULABLE_PLATFORMS)
          .describe("Which platform to plan for"),
        theme: z.string().describe("The content theme or topic for the week"),
      }),
    },
    async ({ platform, theme }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Plan a full week of ${platform} content around the theme: "${theme}".`,
              "",
              "For each day (Monday through Friday, optionally weekend):",
              "1. Suggest a post topic that fits the theme",
              "2. Write a draft caption/text",
              "3. Suggest the best time to post (use your local timezone; mention the timezone explicitly)",
              "4. Note whether it needs an image, video, or is text-only",
              "",
              "After drafting the plan, ask me which posts I want to schedule.",
              "Schedule the ones I approve in one publish_posts call, each with its scheduled_at.",
              "",
              `Keep the tone appropriate for ${platform}. If it's LinkedIn, keep it professional.`,
              "If it's TikTok, make it punchy and short. You get the idea.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
