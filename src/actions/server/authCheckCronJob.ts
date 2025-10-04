/**
 * Validates cron job requests using a secret key
 * @param {string} userId - The user ID for logging purposes
 * @param {string} cronSecret - The secret key provided in the request
 * @returns {Promise<boolean>} Returns true if the secret matches
 */
export async function authCheckCronJob(
  userId: string | null,
  cronSecret: string | undefined
): Promise<boolean> {
  // Ensure the environment variable is set
  if (!process.env.CRON_SECRET_KEY) {
    console.error(
      `[authCheckCronJob] CRON_SECRET_KEY environment variable is not set`
    );
    return false;
  }

  // Validate the cron secret key
  if (cronSecret === process.env.CRON_SECRET_KEY) {
    console.log(
      `[authCheckCronJob] Cron job authentication successful for user ${userId}`
    );
    return true;
  }

  console.error(
    `[authCheckCronJob] Cron job authentication failed: Invalid secret key`
  );
  return false;
}
