import "server-only";

import { timingSafeEqualSecret } from "@/lib/utils/timingSafeEqualSecret";

/**
 * Validates cron job requests using a secret key
 * @param {string} userId - The user ID for logging purposes
 * @param {string} cronSecret - The secret key provided in the request
 * @returns {Promise<boolean>} Returns true if the secret matches
 */
export async function authCheckCronJob(
  userId: string | null,
  cronSecret: string | undefined,
): Promise<boolean> {
  // Ensure the environment variable is set
  const expectedCronSecret = process.env.CRON_SECRET_KEY;
  if (!expectedCronSecret) {
    console.error(
      `[authCheckCronJob] CRON_SECRET_KEY environment variable is not set`,
    );
    return false;
  }

  // Validate the cron secret key. Constant-time: a plain === compares
  // byte by byte and returns early on the first mismatch, which leaks the
  // secret's prefix to anyone who can time the responses.
  if (cronSecret && timingSafeEqualSecret(cronSecret, expectedCronSecret)) {
    return true;
  }

  console.error(
    `[authCheckCronJob] Cron job authentication failed: Invalid secret key`,
  );
  return false;
}
