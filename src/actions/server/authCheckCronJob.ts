import "server-only";

import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

export async function authCheckCronJob(
  userId: string | null,
  cronSecret: string | undefined,
): Promise<boolean> {
  const expectedCronSecret = process.env.CRON_SECRET_KEY;
  if (!expectedCronSecret) {
    console.error(
      `[authCheckCronJob] CRON_SECRET_KEY environment variable is not set`,
    );
    return false;
  }

  if (cronSecret && timingSafeEqualSecret(cronSecret, expectedCronSecret)) {
    return true;
  }

  console.error(
    `[authCheckCronJob] Cron job authentication failed: Invalid secret key`,
  );
  return false;
}
