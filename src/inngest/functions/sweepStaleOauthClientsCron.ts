import { inngest } from "@/inngest/client";
import { sweepStaleOauthClients } from "@/actions/server/data/sweepStaleOauthClients";

export const sweepStaleOauthClientsCron = inngest.createFunction(
  {
    id: "sweep-stale-oauth-clients",
    name: "Sweep stale unverified OAuth clients older than 90d",
    retries: 2,
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("sweep-stale-clients", async () => {
      const stepResult = await sweepStaleOauthClients();
      // Inngest marks a step failed, and retries it, only when it throws:
      // https://www.inngest.com/docs/guides/error-handling
      if (!stepResult.success) throw new Error(`[sweepStaleOauthClientsCron] ${stepResult.message}`);
      return stepResult;
    });

    return {
      ok: true,
      candidatesFound: result.candidatesFound,
      deleted: result.deleted,
    };
  }
);
