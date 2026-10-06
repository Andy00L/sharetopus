import type { McpServer } from "@modelcontextprotocol/server";

/** Prompt: audit the next 14 days of scheduled posts for gaps, clusters and platform balance. */
export function registerAuditCalendar(server: McpServer): void {
  server.registerPrompt(
    "audit_calendar",
    {
      description:
        "Review your next 14 days of scheduled posts. Checks for gaps, clustering, and platform balance.",
    },
    async () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Audit my content calendar for the next 14 days.",
              "",
              "Steps:",
              "1. Use list_posts (status upcoming, to = 14 days from now, limit 100) to fetch the scheduled posts",
              "2. Analyze the schedule and report:",
              "   - Which days have no posts (gaps)",
              "   - Which days have too many posts clustered together",
              "   - Platform distribution (are we ignoring any connected accounts?)",
              "   - Any posts scheduled at suboptimal times for their platform",
              "3. Suggest specific improvements:",
              "   - Posts to reschedule for better timing",
              "   - Gaps that should be filled",
              "   - Platforms that need more attention",
              "",
              "Be specific. If a post should move from 3 AM to 9 AM, say so.",
              "If Tuesday has zero posts, flag it.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
