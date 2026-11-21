import { eventType } from "inngest";
import { z } from "zod";

export const socialAccountTokenRefreshEvent = eventType("social-account.token.refresh", {
  schema: z.object({ social_account_id: z.string() }),
});

export const TOKEN_REFRESH_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

// Inngest drops a repeated event id for 24 hours, so one id per account and
// UTC day makes a second send on the same day a no-op:
// https://www.inngest.com/docs/guides/handling-idempotency
export function buildTokenRefreshEvents(input: {
  socialAccountIds: readonly string[];
  now: Date;
}): ReturnType<typeof socialAccountTokenRefreshEvent.create>[] {
  const utcDay = input.now.toISOString().slice(0, 10);
  return input.socialAccountIds.map((socialAccountId) =>
    socialAccountTokenRefreshEvent.create(
      { social_account_id: socialAccountId },
      { id: `token-refresh-${socialAccountId}-${utcDay}` },
    ),
  );
}
