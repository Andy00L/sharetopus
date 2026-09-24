import "server-only";

import { and, eq, or, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import { ENCRYPTED_TOKEN_PREFIX, isEncryptedToken } from "@/lib/crypto/tokenEncryption";

import { inngest } from "../client";

/** Rows rewritten per run. The table holds one row per connected account. */
const BATCH_SIZE = 500;

/**
 * Rewrites every social_accounts token still stored in plaintext through the
 * encrypting column (schema.ts, encryptedText). Runs daily at 09:00 UTC and
 * on the "social-tokens.encrypt" event, so it can be sent from the Inngest
 * dashboard right after the deploy that ships encryption. Once every row is
 * encrypted, a run is one query that finds nothing; it also catches a row
 * that a still-running old instance wrote in plaintext during the rollout.
 *
 * It runs inside the deployment, with the deployment's key: a backfill from
 * a laptop with a different key would leave every token unreadable.
 *
 * The step returns counts only: Inngest stores step results, and a token
 * must never land there. A failed row is thrown at the end of the step so
 * Inngest records the run as failed; the next run picks the row up again.
 */
export const encryptSocialTokensCron = inngest.createFunction(
  {
    id: "encrypt-social-tokens",
    name: "Encrypt social account tokens stored in plaintext",
    retries: 1,
    triggers: [{ cron: "0 9 * * *" }, { event: "social-tokens.encrypt" }],
  },
  async ({ step }) => {
    const result = await step.run("encrypt-plaintext-tokens", async () => {
      // Raw values on purpose: an sql`` field skips the column's decrypting
      // decoder, and like() would bind its pattern through the encrypting
      // encoder, so the filter is an sql`` template too.
      const encryptedPattern = `${ENCRYPTED_TOKEN_PREFIX}%`;
      const { data: plaintextRows, error: selectError } = await runQuery(
        db
          .select({
            id: social_accounts.id,
            storedAccessToken: sql<string | null>`${social_accounts.access_token}`,
            storedRefreshToken: sql<string | null>`${social_accounts.refresh_token}`,
          })
          .from(social_accounts)
          .where(
            or(
              sql`${social_accounts.access_token} not like ${encryptedPattern}`,
              sql`${social_accounts.refresh_token} not like ${encryptedPattern}`,
            ),
          )
          .limit(BATCH_SIZE),
      );
      if (selectError) {
        throw new Error(`[encryptSocialTokensCron] Select failed: ${selectError.message}`);
      }

      let encryptedRows = 0;
      let failedRows = 0;
      for (const plaintextRow of plaintextRows) {
        // Only the columns still in plaintext are rewritten; set() sends
        // them through the encrypting column.
        const tokenUpdate: { access_token?: string; refresh_token?: string } = {};
        const { storedAccessToken, storedRefreshToken } = plaintextRow;
        if (storedAccessToken !== null && !isEncryptedToken(storedAccessToken)) {
          tokenUpdate.access_token = storedAccessToken;
        }
        if (storedRefreshToken !== null && !isEncryptedToken(storedRefreshToken)) {
          tokenUpdate.refresh_token = storedRefreshToken;
        }

        // Guarded on the stored values just read: a token refreshed in the
        // meantime is already encrypted by its own write and is left alone.
        const { error: updateError } = await runQuery(
          db
            .update(social_accounts)
            .set(tokenUpdate)
            .where(
              and(
                eq(social_accounts.id, plaintextRow.id),
                sql`${social_accounts.access_token} is not distinct from ${storedAccessToken}`,
                sql`${social_accounts.refresh_token} is not distinct from ${storedRefreshToken}`,
              ),
            ),
        );
        if (updateError) {
          failedRows += 1;
          console.error(
            `[encryptSocialTokensCron] Update failed for account ${plaintextRow.id}: ${updateError.message}`,
          );
        } else {
          encryptedRows += 1;
        }
      }

      if (failedRows > 0) {
        throw new Error(
          `[encryptSocialTokensCron] ${failedRows} of ${plaintextRows.length} rows failed; the next run retries them.`,
        );
      }
      return { found: plaintextRows.length, encrypted: encryptedRows };
    });

    console.log(
      `[encryptSocialTokensCron] Encrypted ${result.encrypted} of ${result.found} plaintext rows.`,
    );
    return result;
  },
);
