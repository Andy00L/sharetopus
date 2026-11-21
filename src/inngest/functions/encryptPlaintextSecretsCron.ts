import "server-only";

import { and, eq, notLike, sql, type Query, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { db, runQuery } from "@/db/client";
import { share_links, social_accounts, webhook_subscriptions } from "@/db/schema";
import { hashToken } from "@/lib/api/tokens";
import { ENCRYPTED_TOKEN_PREFIX } from "@/lib/crypto/tokenEncryption";

import { inngest } from "../client";

const BATCH_SIZE = 500;

const ENCRYPTED_VALUE_PATTERN = `${ENCRYPTED_TOKEN_PREFIX}%`;

type GuardedUpdate = PromiseLike<{ count: number }> & { toSQL: () => Query };

type UnfilteredUpdate = { where: (condition: SQL | undefined) => GuardedUpdate };

/**
 * One encrypted column. `rewrite` writes the plaintext back through the
 * column's encrypting encoder; encryptPlaintextColumn adds the WHERE.
 */
interface PlaintextColumnPass {
  stepId: string;
  label: string;
  table: typeof social_accounts | typeof webhook_subscriptions | typeof share_links;
  idColumn: AnyPgColumn;
  encryptedColumn: AnyPgColumn;
  rewrite: (plaintext: string) => UnfilteredUpdate;
}

export const PLAINTEXT_COLUMN_PASSES: readonly PlaintextColumnPass[] = [
  {
    stepId: "encrypt-social-access-tokens",
    label: "social_accounts.access_token",
    table: social_accounts,
    idColumn: social_accounts.id,
    encryptedColumn: social_accounts.access_token,
    rewrite: (plaintext) => db.update(social_accounts).set({ access_token: plaintext }),
  },
  {
    stepId: "encrypt-social-refresh-tokens",
    label: "social_accounts.refresh_token",
    table: social_accounts,
    idColumn: social_accounts.id,
    encryptedColumn: social_accounts.refresh_token,
    rewrite: (plaintext) => db.update(social_accounts).set({ refresh_token: plaintext }),
  },
  {
    stepId: "encrypt-webhook-secrets",
    label: "webhook_subscriptions.secret",
    table: webhook_subscriptions,
    idColumn: webhook_subscriptions.id,
    encryptedColumn: webhook_subscriptions.secret,
    rewrite: (plaintext) => db.update(webhook_subscriptions).set({ secret: plaintext }),
  },
  {
    stepId: "encrypt-share-link-tokens",
    label: "share_links.token",
    table: share_links,
    idColumn: share_links.id,
    encryptedColumn: share_links.token,
    rewrite: (plaintext) =>
      db.update(share_links).set({ token: plaintext, token_hash: hashToken(plaintext) }),
  },
];

/**
 * Drizzle decodes an sql`` select field with a no-op decoder, so it reads the
 * stored value raw, while eq() binds through the column's encrypting encoder;
 * the guard therefore compares in sql``. notLike() binds its pattern raw.
 * sourceRef: node_modules/drizzle-orm/utils.js (mapResultRow),
 * node_modules/drizzle-orm/sql/expressions/conditions.js (bindIfParam, notLike).
 */
export function buildPlaintextColumnQueries(pass: PlaintextColumnPass) {
  return {
    selectPlaintext: db
      .select({
        id: sql<string>`${pass.idColumn}`,
        storedValue: sql<string>`${pass.encryptedColumn}`,
      })
      .from(pass.table)
      .where(notLike(pass.encryptedColumn, ENCRYPTED_VALUE_PATTERN))
      .limit(BATCH_SIZE),
    rewriteIfUnchanged: (row: { id: string; storedValue: string }) =>
      pass
        .rewrite(row.storedValue)
        .where(
          and(
            eq(pass.idColumn, row.id),
            sql`${pass.encryptedColumn} = ${row.storedValue}`,
          ),
        ),
  };
}

/**
 * Returns counts only: Inngest stores step results, and a secret must never
 * land there. Throws on failure because it runs inside step.run and Inngest
 * retries only a throw: https://www.inngest.com/docs/guides/error-handling
 */
async function encryptPlaintextColumn(
  pass: PlaintextColumnPass,
): Promise<{ found: number; encrypted: number }> {
  const queries = buildPlaintextColumnQueries(pass);
  const { data: plaintextRows, error: selectError } = await runQuery(queries.selectPlaintext);
  if (selectError) {
    throw new Error(`[encryptPlaintextColumn] ${pass.label} select failed: ${selectError.message}`);
  }

  let encryptedRows = 0;
  let failedRows = 0;
  for (const plaintextRow of plaintextRows) {
    const { data: updateResult, error: updateError } = await runQuery(
      queries.rewriteIfUnchanged(plaintextRow),
    );
    if (updateError) {
      failedRows += 1;
      console.error(
        `[encryptPlaintextColumn] ${pass.label} update failed for row ${plaintextRow.id}: ${updateError.message}`,
      );
    } else {
      encryptedRows += updateResult.count;
    }
  }

  if (failedRows > 0) {
    throw new Error(
      `[encryptPlaintextColumn] ${failedRows} of ${plaintextRows.length} ${pass.label} rows failed.`,
    );
  }
  return { found: plaintextRows.length, encrypted: encryptedRows };
}

export const encryptPlaintextSecretsCron = inngest.createFunction(
  {
    id: "encrypt-plaintext-secrets",
    name: "Encrypt tokens and secrets stored in plaintext",
    retries: 1,
    triggers: [{ cron: "0 9 * * *" }, { event: "secrets.encrypt-plaintext" }],
  },
  async ({ step }) => {
    const countsByColumn: Record<string, { found: number; encrypted: number }> = {};
    for (const pass of PLAINTEXT_COLUMN_PASSES) {
      countsByColumn[pass.label] = await step.run(pass.stepId, () => encryptPlaintextColumn(pass));
    }
    console.log(`[encryptPlaintextSecretsCron] ${JSON.stringify(countsByColumn)}`);
    return countsByColumn;
  },
);
