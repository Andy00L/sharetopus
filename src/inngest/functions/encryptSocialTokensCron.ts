import "server-only";

import { and, eq, or, sql } from "drizzle-orm";

import { db, runQuery, type QueryResult } from "@/db/client";
import { share_links, social_accounts, webhook_subscriptions } from "@/db/schema";
import { hashToken } from "@/lib/api/tokens";
import { ENCRYPTED_TOKEN_PREFIX, isEncryptedToken } from "@/lib/crypto/tokenEncryption";

import { inngest } from "../client";

/** Rows rewritten per table per run. Each table holds a few rows per user. */
const BATCH_SIZE = 500;

/** A LIKE pattern that matches every value the encrypting column wrote. */
const ENCRYPTED_VALUE_PATTERN = `${ENCRYPTED_TOKEN_PREFIX}%`;

type EncryptionPassResult = { found: number; encrypted: number };

/**
 * One table's pass: select the rows still in plaintext, then rewrite each
 * one through its encrypting column. Selects read raw values on purpose:
 * an sql`` field skips the column's decrypting decoder, and like() would
 * bind its pattern through the encrypting encoder, so filters and guards
 * are sql`` templates too.
 */
type PlaintextPass<Row extends { id: string }> = {
  /** Names the table in logs and errors. */
  table: string;
  selectPlaintext: () => Promise<QueryResult<Row[]>>;
  /**
   * Guarded on the stored values just read: a value rewritten in the
   * meantime is already encrypted by its own write and is left alone.
   */
  rewrite: (row: Row) => Promise<QueryResult<unknown>>;
};

/**
 * Runs one pass and returns counts only: Inngest stores step results, and
 * a token must never land there. Called inside step.run, so it throws on
 * failure (the Inngest retry exception to errors as values): a failed
 * select, or any failed row, marks the run failed and the next run picks
 * the rows up again.
 */
async function encryptPlaintextRows<Row extends { id: string }>(
  pass: PlaintextPass<Row>,
): Promise<EncryptionPassResult> {
  const { data: plaintextRows, error: selectError } = await pass.selectPlaintext();
  if (selectError) {
    throw new Error(`[encryptPlaintextRows] ${pass.table} select failed: ${selectError.message}`);
  }

  let encryptedRows = 0;
  let failedRows = 0;
  for (const plaintextRow of plaintextRows) {
    const { error: updateError } = await pass.rewrite(plaintextRow);
    if (updateError) {
      failedRows += 1;
      console.error(
        `[encryptPlaintextRows] ${pass.table} update failed for row ${plaintextRow.id}: ${updateError.message}`,
      );
    } else {
      encryptedRows += 1;
    }
  }

  if (failedRows > 0) {
    throw new Error(
      `[encryptPlaintextRows] ${failedRows} of ${plaintextRows.length} ${pass.table} rows failed; the next run retries them.`,
    );
  }
  return { found: plaintextRows.length, encrypted: encryptedRows };
}

/** social_accounts: the OAuth access and refresh tokens. */
const socialTokensPass: PlaintextPass<{
  id: string;
  storedAccessToken: string | null;
  storedRefreshToken: string | null;
}> = {
  table: "social_accounts",
  selectPlaintext: () =>
    runQuery(
      db
        .select({
          id: social_accounts.id,
          storedAccessToken: sql<string | null>`${social_accounts.access_token}`,
          storedRefreshToken: sql<string | null>`${social_accounts.refresh_token}`,
        })
        .from(social_accounts)
        .where(
          or(
            sql`${social_accounts.access_token} not like ${ENCRYPTED_VALUE_PATTERN}`,
            sql`${social_accounts.refresh_token} not like ${ENCRYPTED_VALUE_PATTERN}`,
          ),
        )
        .limit(BATCH_SIZE),
    ),
  rewrite: ({ id, storedAccessToken, storedRefreshToken }) => {
    // Only the columns still in plaintext are rewritten; set() sends them
    // through the encrypting column.
    const tokenUpdate: { access_token?: string; refresh_token?: string } = {};
    if (storedAccessToken !== null && !isEncryptedToken(storedAccessToken)) {
      tokenUpdate.access_token = storedAccessToken;
    }
    if (storedRefreshToken !== null && !isEncryptedToken(storedRefreshToken)) {
      tokenUpdate.refresh_token = storedRefreshToken;
    }
    return runQuery(
      db
        .update(social_accounts)
        .set(tokenUpdate)
        .where(
          and(
            eq(social_accounts.id, id),
            sql`${social_accounts.access_token} is not distinct from ${storedAccessToken}`,
            sql`${social_accounts.refresh_token} is not distinct from ${storedRefreshToken}`,
          ),
        ),
    );
  },
};

/** webhook_subscriptions: the secret that signs each delivery. */
const webhookSecretsPass: PlaintextPass<{ id: string; storedSecret: string }> = {
  table: "webhook_subscriptions",
  selectPlaintext: () =>
    runQuery(
      db
        .select({
          id: webhook_subscriptions.id,
          storedSecret: sql<string>`${webhook_subscriptions.secret}`,
        })
        .from(webhook_subscriptions)
        .where(sql`${webhook_subscriptions.secret} not like ${ENCRYPTED_VALUE_PATTERN}`)
        .limit(BATCH_SIZE),
    ),
  rewrite: ({ id, storedSecret }) =>
    runQuery(
      db
        .update(webhook_subscriptions)
        .set({ secret: storedSecret })
        .where(
          and(
            eq(webhook_subscriptions.id, id),
            sql`${webhook_subscriptions.secret} = ${storedSecret}`,
          ),
        ),
    ),
};

/**
 * share_links: the token. token_hash is written in the same update, so a
 * row created before hashing shipped stays reachable once its token is
 * encrypted.
 */
const shareLinkTokensPass: PlaintextPass<{ id: string; storedToken: string }> = {
  table: "share_links",
  selectPlaintext: () =>
    runQuery(
      db
        .select({
          id: share_links.id,
          storedToken: sql<string>`${share_links.token}`,
        })
        .from(share_links)
        .where(sql`${share_links.token} not like ${ENCRYPTED_VALUE_PATTERN}`)
        .limit(BATCH_SIZE),
    ),
  rewrite: ({ id, storedToken }) =>
    runQuery(
      db
        .update(share_links)
        .set({ token: storedToken, token_hash: hashToken(storedToken) })
        .where(and(eq(share_links.id, id), sql`${share_links.token} = ${storedToken}`)),
    ),
};

/**
 * Rewrites every value still stored in plaintext through its encrypting
 * column (schema.ts, encryptedText): social account tokens, webhook secrets
 * and share-link tokens. Runs daily at 09:00 UTC and on the
 * "social-tokens.encrypt" event, so it can be sent from the Inngest
 * dashboard right after a deploy that encrypts a column. Once every row is
 * encrypted, a run is three queries that find nothing; it also catches a
 * row that a still-running old instance wrote in plaintext during a rollout.
 *
 * It runs inside the deployment, with the deployment's key: a backfill from
 * a laptop with a different key would leave every value unreadable. The id
 * and event name predate the two newer tables and stay for continuity.
 */
export const encryptSocialTokensCron = inngest.createFunction(
  {
    id: "encrypt-social-tokens",
    name: "Encrypt tokens and secrets stored in plaintext",
    retries: 1,
    triggers: [{ cron: "0 9 * * *" }, { event: "social-tokens.encrypt" }],
  },
  async ({ step }) => {
    const socialTokens = await step.run("encrypt-plaintext-tokens", () =>
      encryptPlaintextRows(socialTokensPass),
    );
    const webhookSecrets = await step.run("encrypt-webhook-secrets", () =>
      encryptPlaintextRows(webhookSecretsPass),
    );
    const shareLinkTokens = await step.run("encrypt-share-link-tokens", () =>
      encryptPlaintextRows(shareLinkTokensPass),
    );

    const result = { socialTokens, webhookSecrets, shareLinkTokens };
    console.log(
      `[encryptSocialTokensCron] Encrypted ${socialTokens.encrypted}/${socialTokens.found} social accounts, ` +
        `${webhookSecrets.encrypted}/${webhookSecrets.found} webhook secrets, ` +
        `${shareLinkTokens.encrypted}/${shareLinkTokens.found} share links.`,
    );
    return result;
  },
);
