import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq, isNull, sql } from "drizzle-orm";

import { redis } from "@/actions/api/upstash";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import {
  BLUESKY_REQUEST_TIMEOUT_MS,
  REGISTRY_OAUTH_REQUEST_TIMEOUT_MS,
  TOKEN_REFRESH_LOCK_TTL_MS,
  TOKEN_REFRESH_REQUEST_TIMEOUT_MS,
  TOKEN_REFRESH_WAIT_DEADLINE_MS,
} from "@/lib/api/_shared/platformFetchTimeouts";
import { RUNTIME } from "@/lib/jobs/runtimeConfig";
import type { SocialAccount } from "@/lib/types/dbTypes";

const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

const POLL_INITIAL_INTERVAL_MS = 500;
const POLL_MAX_INTERVAL_MS = 4_000;
const CREDENTIAL_WRITE_ATTEMPTS = 2;

const LEASE_RENEW_INTERVAL_MS = TOKEN_REFRESH_LOCK_TTL_MS / 3;
const LOCK_HOLD_LIMIT_MS = RUNTIME.maxDurationS * 1000;
const SLOWEST_ROTATING_REFRESH_CALL_MS = Math.max(
  TOKEN_REFRESH_REQUEST_TIMEOUT_MS,
  REGISTRY_OAUTH_REQUEST_TIMEOUT_MS,
  BLUESKY_REQUEST_TIMEOUT_MS,
);
const STORE_DEADLINE_CLOCK_MARGIN_MS = 5_000;
const LEASE_LEFT_TO_START_REFRESH_MS =
  SLOWEST_ROTATING_REFRESH_CALL_MS + STORE_DEADLINE_CLOCK_MARGIN_MS;

// Both scripts act only while this run still owns the lock. A plain DEL or PEXPIRE
// could act on a lock that another run took after ours expired:
// https://redis.io/docs/latest/commands/set/ (section "Patterns")
const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';
const EXTEND_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end';

export type StoredCredential = Pick<
  SocialAccount,
  "access_token" | "refresh_token" | "token_expires_at"
>;

type LockedRefreshOutcome<Refreshed> =
  | { kind: "stored_token_fresh"; accessToken: string }
  | { kind: "refreshed"; value: Refreshed }
  | { kind: "unavailable"; message: string };

export type RefreshWindowOptions = { refreshIfExpiringWithinMs?: number };

export type RefreshTokenRotation = "rotating" | "stable";

type CredentialStoreOutcome =
  | { kind: "stored" }
  | { kind: "superseded"; accessToken: string }
  | { kind: "failed"; message: string };

export type LockedCredential = {
  stored: StoredCredential;
  storeCredential: (credential: StoredCredential) => Promise<CredentialStoreOutcome>;
};

type RefusedRefreshOutcome =
  | { kind: "refreshed_elsewhere"; accessToken: string }
  | { kind: "needs_reconnect" }
  | { kind: "retry_later" };

type RefreshLease = { readConfirmedEndMs: () => number };

type RenewedRefreshLease = RefreshLease & { stopRenewing: () => void };

type HeldLock = { lockKey: string; ownerId: string; requestedAtMs: number };

type LockAttempt =
  | { kind: "acquired"; ownerId: string }
  | { kind: "held" }
  | { kind: "unavailable"; message: string };

type LockRenewal =
  | { kind: "extended" }
  | { kind: "lost" }
  | { kind: "unavailable"; message: string };

export function isTokenExpiring(
  expiresAt: string | null,
  withinMs: number = TOKEN_EXPIRY_BUFFER_MS,
): boolean {
  if (!expiresAt) return false;
  return Date.now() + withinMs >= new Date(expiresAt).getTime();
}

function selectFreshAccessToken(
  credential: StoredCredential,
  withinMs: number = TOKEN_EXPIRY_BUFFER_MS,
): string | null {
  if (!credential.access_token || isTokenExpiring(credential.token_expires_at, withinMs)) {
    return null;
  }
  return credential.access_token;
}

export async function refreshWithAccountLock<Refreshed>(input: {
  accountId: string;
  refreshTokenRotation: RefreshTokenRotation;
  refreshStoredCredential: (locked: LockedCredential) => Promise<Refreshed>;
  refreshIfExpiringWithinMs?: number;
}): Promise<LockedRefreshOutcome<Refreshed>> {
  const { accountId, refreshStoredCredential } = input;
  const withinMs = input.refreshIfExpiringWithinMs ?? TOKEN_EXPIRY_BUFFER_MS;
  const lockKey = `token_refresh_lock:${accountId}`;
  const deadline = Date.now() + TOKEN_REFRESH_WAIT_DEADLINE_MS;
  let pollIndex = 0;

  do {
    const lockRequestedAtMs = Date.now();
    const lock = await tryAcquireRefreshLock(lockKey);
    if (lock.kind === "unavailable" && input.refreshTokenRotation === "rotating") {
      console.warn(
        `[refreshWithAccountLock] Lock unavailable, not refreshing account ${accountId}: its refresh token rotates. ${lock.message}`,
      );
      return { kind: "unavailable", message: lock.message };
    }
    if (lock.kind === "unavailable") {
      console.warn(
        `[refreshWithAccountLock] Lock unavailable, refreshing account ${accountId} without it: ${lock.message}`,
      );
      return refreshIfStillExpiring({ accountId, withinMs, lease: null, refreshStoredCredential });
    }
    if (lock.kind === "acquired") {
      const lease = holdRenewedLease({ lockKey, ownerId: lock.ownerId, requestedAtMs: lockRequestedAtMs });
      try {
        return await refreshIfStillExpiring({ accountId, withinMs, lease, refreshStoredCredential });
      } finally {
        lease.stopRenewing();
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

async function readStoredCredential(
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

async function storeRefreshedCredential(input: {
  accountId: string;
  replacedExpiresAt: string | null;
  credential: StoredCredential;
  lease: RefreshLease | null;
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
            input.lease === null
              ? undefined
              : isBeforeDatabaseTime(input.lease.readConfirmedEndMs() - STORE_DEADLINE_CLOCK_MARGIN_MS),
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
  return {
    kind: "failed",
    message: "The store matched no row (the row changed or the refresh lock lapsed) and the row holds no fresh token.",
  };
}

function holdsTokenExpiry(expiresAt: string | null) {
  return expiresAt === null
    ? isNull(social_accounts.token_expires_at)
    : eq(social_accounts.token_expires_at, expiresAt);
}

function isBeforeDatabaseTime(deadlineMs: number) {
  return sql`clock_timestamp() < ${new Date(deadlineMs).toISOString()}::timestamptz`;
}

async function refreshIfStillExpiring<Refreshed>(input: {
  accountId: string;
  withinMs: number;
  lease: RefreshLease | null;
  refreshStoredCredential: (locked: LockedCredential) => Promise<Refreshed>;
}): Promise<LockedRefreshOutcome<Refreshed>> {
  const { accountId, lease } = input;
  const stored = await readStoredCredential(accountId);
  if (!stored.ok) return { kind: "unavailable", message: stored.message };
  const freshToken = selectFreshAccessToken(stored.credential, input.withinMs);
  if (freshToken) return { kind: "stored_token_fresh", accessToken: freshToken };
  if (lease && Date.now() + LEASE_LEFT_TO_START_REFRESH_MS > lease.readConfirmedEndMs()) {
    console.warn(
      `[refreshIfStillExpiring] The refresh lock on account ${accountId} lapses too soon to start a refresh.`,
    );
    return { kind: "unavailable", message: "The refresh lock lapses too soon to start a refresh." };
  }
  const value = await input.refreshStoredCredential({
    stored: stored.credential,
    storeCredential: (credential) =>
      storeRefreshedCredential({
        accountId,
        replacedExpiresAt: stored.credential.token_expires_at,
        credential,
        lease,
      }),
  });
  return { kind: "refreshed", value };
}

function holdRenewedLease(lock: HeldLock): RenewedRefreshLease {
  const renewal = new AbortController();
  const lease = { confirmedEndMs: lock.requestedAtMs + TOKEN_REFRESH_LOCK_TTL_MS };
  void renewLeaseUntilStopped({ lock, lease, signal: renewal.signal });
  return {
    readConfirmedEndMs: () => lease.confirmedEndMs,
    stopRenewing: () => renewal.abort(),
  };
}

async function renewLeaseUntilStopped(input: {
  lock: HeldLock;
  lease: { confirmedEndMs: number };
  signal: AbortSignal;
}): Promise<void> {
  const { lock, lease, signal } = input;
  const lastRenewalByMs = lock.requestedAtMs + LOCK_HOLD_LIMIT_MS - TOKEN_REFRESH_LOCK_TTL_MS;
  while (await waitForNextRenewal(signal)) {
    const renewRequestedAtMs = Date.now();
    if (renewRequestedAtMs > lastRenewalByMs) {
      console.warn(
        `[renewLeaseUntilStopped] Stopped renewing ${lock.lockKey}: the holder has run as long as a function can.`,
      );
      return;
    }
    const renewal = await extendRefreshLock(lock);
    if (signal.aborted) return;
    switch (renewal.kind) {
      case "extended":
        lease.confirmedEndMs = renewRequestedAtMs + TOKEN_REFRESH_LOCK_TTL_MS;
        break;
      case "lost":
        lease.confirmedEndMs = Math.min(lease.confirmedEndMs, renewRequestedAtMs);
        console.warn(
          `[renewLeaseUntilStopped] ${lock.lockKey} is no longer held by this run; it will not store a refreshed token.`,
        );
        return;
      case "unavailable":
        console.warn(
          `[renewLeaseUntilStopped] Could not renew ${lock.lockKey}; its lease still ends at ${new Date(lease.confirmedEndMs).toISOString()}. ${renewal.message}`,
        );
        break;
    }
  }
}

function waitForNextRenewal(signal: AbortSignal): Promise<boolean> {
  return sleep(LEASE_RENEW_INTERVAL_MS, true, { signal }).catch(() => false);
}

async function extendRefreshLock(lock: HeldLock): Promise<LockRenewal> {
  try {
    const extendedCount = await redis.eval(
      EXTEND_LOCK_SCRIPT,
      [lock.lockKey],
      [lock.ownerId, String(TOKEN_REFRESH_LOCK_TTL_MS)],
    );
    return extendedCount === 1 ? { kind: "extended" } : { kind: "lost" };
  } catch (error) {
    return {
      kind: "unavailable",
      message: error instanceof Error ? error.message : String(error),
    };
  }
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
