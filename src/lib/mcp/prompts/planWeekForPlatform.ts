import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/**
 * Prompt: plan a week of content for a specific platform.
 *
 * Returns a structured user message that asks the agent to plan
 * 5-7 posts around a theme for the given platform.
 */
export function registerPlanWeekForPlatform(server: McpServer): void {
  server.prompt(
    "plan_week_for_platform",
    {
      platform: z
        .enum(["linkedin", "tiktok", "pinterest", "instagram"])
        .describe("Which platform to plan for"),
      theme: z.string().describe("The content theme or topic for the week"),
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
              "For the ones I approve, use the schedule_post or bulk_schedule tool.",
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
