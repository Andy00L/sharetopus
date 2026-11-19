import { inngest } from "@/inngest/client";
import { sweepStaleOauthClients } from "@/actions/server/data/sweepStaleOauthClients";

export const sweepStaleOauthClientsCron = inngest.createFunction(
  {
    id: "sweep-stale-oauth-clients",
    name: "Sweep stale unverified OAuth clients older than 90d",
    retries: 0,
    triggers: [{ cron: "0 4 * * *" }],
  },
  async ({ step }) => {
    const result = await step.run("sweep-stale-clients", () =>
      sweepStaleOauthClients()
    );

    if (!result.success) {
      console.error(
        `[sweepStaleOauthClientsCron] ${result.message}`
      );
      return { ok: false, reason: result.message };
    }

    return {
      ok: true,
      candidatesFound: result.candidatesFound,
      deleted: result.deleted,
    };
  }
);
