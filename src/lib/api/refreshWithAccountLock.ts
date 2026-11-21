import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq, isNull } from "drizzle-orm";

import { redis } from "@/actions/api/upstash";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import {
  TOKEN_REFRESH_LOCK_TTL_MS,
  TOKEN_REFRESH_WAIT_DEADLINE_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import type { SocialAccount } from "@/lib/types/dbTypes";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const POLL_INITIAL_INTERVAL_MS = 500;
const POLL_MAX_INTERVAL_MS = 4_000;
const CREDENTIAL_WRITE_ATTEMPTS = 2;

// Deletes the lock only while this run still owns it. A plain DEL could remove a
// lock that another run took after ours expired:
// https://redis.io/docs/latest/commands/set/ (section "Patterns")
const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export type StoredCredential = Pick<
  SocialAccount,
  "access_token" | "refresh_token" | "token_expires_at"
>;

export type LockedRefreshOutcome<Refreshed> =
  | { kind: "stored_token_fresh"; accessToken: string }
  | { kind: "refreshed"; value: Refreshed }
  | { kind: "unavailable"; message: string };

export type RefreshWindowOptions = { refreshIfExpiringWithinMs?: number };

export type CredentialStoreOutcome =
  | { kind: "stored" }
  | { kind: "superseded"; accessToken: string }
  | { kind: "failed"; message: string };

export type RefusedRefreshOutcome =
  | { kind: "refreshed_elsewhere"; accessToken: string }
  | { kind: "needs_reconnect" }
  | { kind: "retry_later" };

type LockAttempt =
  | { kind: "acquired"; ownerId: string }
  | { kind: "held" }
  | { kind: "unavailable"; message: string };

export function isTokenExpiring(
  expiresAt: string | null,
  withinMs: number = TOKEN_EXPIRY_BUFFER_MS,
): boolean {
  if (!expiresAt) return false;
  return Date.now() + withinMs >= new Date(expiresAt).getTime();
}

export function selectFreshAccessToken(
  credential: StoredCredential,
  withinMs: number = TOKEN_EXPIRY_BUFFER_MS,
): string | null {
  if (!credential.access_token || isTokenExpiring(credential.token_expires_at, withinMs)) {
    return null;
  }
  return credential.access_token;
}

export async function refreshWithAccountLock<Refreshed>(
  accountId: string,
  refreshStoredCredential: (stored: StoredCredential) => Promise<Refreshed>,
  options: RefreshWindowOptions = {},
): Promise<LockedRefreshOutcome<Refreshed>> {
  const withinMs = options.refreshIfExpiringWithinMs ?? TOKEN_EXPIRY_BUFFER_MS;
  const lockKey = `token_refresh_lock:${accountId}`;
  const deadline = Date.now() + TOKEN_REFRESH_WAIT_DEADLINE_MS;
  let pollIndex = 0;

  do {
    const lock = await tryAcquireRefreshLock(lockKey);
    if (lock.kind === "unavailable") {
      console.warn(
        `[refreshWithAccountLock] Lock unavailable, refreshing account ${accountId} without it: ${lock.message}`,
      );
      return refreshIfStillExpiring(accountId, withinMs, refreshStoredCredential);
    }
    if (lock.kind === "acquired") {
      try {
        return await refreshIfStillExpiring(accountId, withinMs, refreshStoredCredential);
      } finally {
        await releaseRefreshLock(lockKey, lock.ownerId);
      }
    }

    await sleep(Math.min(POLL_MAX_INTERVAL_MS, POLL_INITIAL_INTERVAL_MS * 2 ** pollIndex));
    pollIndex++;
    const stored = await readStoredCredential(accountId);
    if (!stored.ok) return { kind: "unavailable", message: stored.message };
    const freshToken = selectFreshAccessToken(stored.credential, withinMs);
    if (freshToken) return { kind: "stored_token_fresh", accessToken: freshToken };
  } while (Date.now() < deadline);

  console.error(
    `[refreshWithAccountLock] Gave up waiting on another refresh of account ${accountId}.`,
  );
  return {
    kind: "unavailable",
    message: "Another refresh of this account is still running.",
  };
}

export async function readStoredCredential(
  accountId: string,
): Promise<{ ok: true; credential: StoredCredential } | { ok: false; message: string }> {
  const { data: rows, error } = await runQuery(
    db
      .select({
        access_token: social_accounts.access_token,
        refresh_token: social_accounts.refresh_token,
        token_expires_at: social_accounts.token_expires_at,
      })
      .from(social_accounts)
      .where(eq(social_accounts.id, accountId))
      .limit(1),
  );
  if (error) {
    console.error(
      `[readStoredCredential] Read failed for account ${accountId}: ${error.message}`,
    );
    return { ok: false, message: "Could not read the account's stored token." };
  }
  const row = rows[0];
  if (!row) return { ok: false, message: "The account no longer exists." };
  return { ok: true, credential: row };
}

export async function settleRefusedRefresh(input: {
  accountId: string;
  platform: string;
  refusedExpiresAt: string | null;
}): Promise<RefusedRefreshOutcome> {
  const stored = await readStoredCredential(input.accountId);
  const freshToken =
    stored.ok && stored.credential.token_expires_at !== input.refusedExpiresAt
      ? selectFreshAccessToken(stored.credential)
      : null;
  if (freshToken) return { kind: "refreshed_elsewhere", accessToken: freshToken };

  const { data: flaggedRows, error: flagError } = await runQuery(
    db
      .update(social_accounts)
      .set({ is_available: false, updated_at: new Date().toISOString() })
      .where(
        and(
          eq(social_accounts.id, input.accountId),
          holdsTokenExpiry(input.refusedExpiresAt),
        ),
      )
      .returning({ id: social_accounts.id }),
  );
  if (flagError) {
    console.error(
      `[settleRefusedRefresh ${input.platform}] Could not flag account ${input.accountId} as unavailable: ${flagError.message}`,
    );
    return { kind: "retry_later" };
  }
  if (flaggedRows.length > 0) {
    console.warn(
      `[settleRefusedRefresh ${input.platform}] Account ${input.accountId} flagged as needing re-authentication.`,
    );
    return { kind: "needs_reconnect" };
  }

  const current = await readStoredCredential(input.accountId);
  const currentToken = current.ok ? selectFreshAccessToken(current.credential) : null;
  if (currentToken) return { kind: "refreshed_elsewhere", accessToken: currentToken };
  console.warn(
    `[settleRefusedRefresh ${input.platform}] Account ${input.accountId} changed after the refusal but holds no fresh token; asking to retry later.`,
  );
  return { kind: "retry_later" };
}

export async function storeRefreshedCredential(input: {
  accountId: string;
  replacedExpiresAt: string | null;
  credential: StoredCredential;
}): Promise<CredentialStoreOutcome> {
  let lastErrorMessage = "";
  for (let attemptNumber = 1; attemptNumber <= CREDENTIAL_WRITE_ATTEMPTS; attemptNumber++) {
    const { data: storedRows, error } = await runQuery(
      db
        .update(social_accounts)
        .set({ ...input.credential, is_available: true, updated_at: new Date().toISOString() })
        .where(
          and(
            eq(social_accounts.id, input.accountId),
            holdsTokenExpiry(input.replacedExpiresAt),
          ),
        )
        .returning({ id: social_accounts.id }),
    );
    if (!error) {
      return storedRows.length > 0 ? { kind: "stored" } : settleUnmatchedStore(input);
    }
    lastErrorMessage = error.message;
    console.warn(
      `[storeRefreshedCredential] Write ${attemptNumber} of ${CREDENTIAL_WRITE_ATTEMPTS} failed for account ${input.accountId}: ${error.message}`,
    );
  }
  return { kind: "failed", message: lastErrorMessage };
}

async function settleUnmatchedStore(input: {
  accountId: string;
  credential: StoredCredential;
}): Promise<CredentialStoreOutcome> {
  const current = await readStoredCredential(input.accountId);
  if (!current.ok) return { kind: "failed", message: current.message };
  if (current.credential.access_token === input.credential.access_token) return { kind: "stored" };
  const currentToken = selectFreshAccessToken(current.credential);
  if (currentToken) {
    console.warn(
      `[settleUnmatchedStore] Another refresh stored a newer token for account ${input.accountId}; keeping it.`,
    );
    return { kind: "superseded", accessToken: currentToken };
  }
  return { kind: "failed", message: "The stored credential changed and holds no fresh token." };
}

function holdsTokenExpiry(expiresAt: string | null) {
  return expiresAt === null
    ? isNull(social_accounts.token_expires_at)
    : eq(social_accounts.token_expires_at, expiresAt);
}

async function refreshIfStillExpiring<Refreshed>(
  accountId: string,
  withinMs: number,
  refreshStoredCredential: (stored: StoredCredential) => Promise<Refreshed>,
): Promise<LockedRefreshOutcome<Refreshed>> {
  const stored = await readStoredCredential(accountId);
  if (!stored.ok) return { kind: "unavailable", message: stored.message };
  const freshToken = selectFreshAccessToken(stored.credential, withinMs);
  if (freshToken) return { kind: "stored_token_fresh", accessToken: freshToken };
  return { kind: "refreshed", value: await refreshStoredCredential(stored.credential) };
}

async function tryAcquireRefreshLock(lockKey: string): Promise<LockAttempt> {
  const ownerId = randomUUID();
  try {
    const reply = await redis.set(lockKey, ownerId, { nx: true, px: TOKEN_REFRESH_LOCK_TTL_MS });
    return reply === "OK" ? { kind: "acquired", ownerId } : { kind: "held" };
  } catch (error) {
    return {
      kind: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function releaseRefreshLock(lockKey: string, ownerId: string): Promise<void> {
  try {
    await redis.eval(RELEASE_LOCK_SCRIPT, [lockKey], [ownerId]);
  } catch (error) {
    console.error(
      `[releaseRefreshLock] Release failed for ${lockKey}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
