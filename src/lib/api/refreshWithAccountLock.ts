import "server-only";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

import { redis } from "@/actions/api/upstash";
import { db, runQuery } from "@/db/client";
import { social_accounts } from "@/db/schema";
import type { SocialAccount } from "@/lib/types/dbTypes";

/** A stored token counts as expired this long before it dies, so a publish
 * never starts with a token that expires mid-upload. Milliseconds. */
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/** Lifetime of a refresh lock, in milliseconds. Longer than the slowest
 * refresh call (30 s, VARIANT_TIMEOUT_MS in
 * src/lib/platforms/providers/oauthVariants.ts) plus the database write, so
 * a live refresh never outlasts its lock. */
const LOCK_TTL_MS = 45_000;

/** How long a run waits on another run's refresh, in milliseconds. Longer
 * than LOCK_TTL_MS, so a waiter outlasts the lock of a run that crashed. */
const WAIT_DEADLINE_MS = LOCK_TTL_MS + 5_000;

/** Pause between checks while another run holds the lock, in milliseconds. */
const POLL_INTERVAL_MS = 500;

/** Deletes the lock only while this run still owns it. A plain DEL could
 * remove a lock that another run took after ours expired.
 * sourceRef: https://redis.io/docs/latest/commands/set/ (section "Patterns") */
const RELEASE_LOCK_SCRIPT =
  'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export type StoredCredential = Pick<
  SocialAccount,
  "access_token" | "refresh_token" | "token_expires_at"
>;

export type LockedRefreshOutcome<Refreshed> =
  /** Another run refreshed the account; its token is in the row. */
  | { kind: "stored_token_fresh"; accessToken: string }
  /** This run refreshed; `value` is what the refresh returned. */
  | { kind: "refreshed"; value: Refreshed }
  /** The row could not be read, or another run's refresh ran too long. */
  | { kind: "unavailable"; message: string };

type LockAttempt =
  | { kind: "acquired"; ownerId: string }
  | { kind: "held" }
  | { kind: "unavailable"; message: string };

/**
 * Whether a stored token is expired or expires within the next 5 minutes.
 * A null expiry means the token does not expire (Facebook Page tokens,
 * credential providers).
 */
export function isTokenExpiring(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  return Date.now() + TOKEN_EXPIRY_BUFFER_MS >= new Date(expiresAt).getTime();
}

/** The stored access token when it is present and not expiring, else null. */
export function selectFreshAccessToken(credential: StoredCredential): string | null {
  if (!credential.access_token || isTokenExpiring(credential.token_expires_at)) {
    return null;
  }
  return credential.access_token;
}

/**
 * Runs `refreshStoredCredential` for one social account under a short Redis
 * lock, so concurrent runs never refresh the same account twice. Without it,
 * two runs that found the same expired token both refreshed it: where the
 * platform rotates the refresh token (X does on every refresh) the second
 * refresh was refused, which failed that post and could flag a healthy
 * account as needing a reconnect.
 *
 * The lock holder re-reads the row and refreshes only when the stored token
 * is still expiring, with the stored refresh token (the caller's copy may
 * predate a rotation). Other runs wait and return the token the holder
 * saved. When Redis is unreachable, the refresh runs without the lock, as
 * it did before the lock existed.
 *
 * Called by: ensureValidToken (the 7 legacy platforms) and
 * publishViaRegistry's ensureFreshRegistryToken (registry providers).
 */
export async function refreshWithAccountLock<Refreshed>(
  accountId: string,
  refreshStoredCredential: (stored: StoredCredential) => Promise<Refreshed>,
): Promise<LockedRefreshOutcome<Refreshed>> {
  const lockKey = `token_refresh_lock:${accountId}`;
  const deadline = Date.now() + WAIT_DEADLINE_MS;

  do {
    const lock = await tryAcquireRefreshLock(lockKey);
    if (lock.kind === "unavailable") {
      console.warn(
        `[refreshWithAccountLock] Lock unavailable, refreshing account ${accountId} without it: ${lock.message}`,
      );
      return refreshIfStillExpiring(accountId, refreshStoredCredential);
    }
    if (lock.kind === "acquired") {
      try {
        return await refreshIfStillExpiring(accountId, refreshStoredCredential);
      } finally {
        await releaseRefreshLock(lockKey, lock.ownerId);
      }
    }

    await waitFor(POLL_INTERVAL_MS);
    const stored = await readStoredCredential(accountId);
    if (!stored.ok) return { kind: "unavailable", message: stored.message };
    const freshToken = selectFreshAccessToken(stored.credential);
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

/**
 * Reads the account's stored credential. Used under the refresh lock, and
 * by ensureValidToken when a refused refresh may have raced another run.
 */
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

async function refreshIfStillExpiring<Refreshed>(
  accountId: string,
  refreshStoredCredential: (stored: StoredCredential) => Promise<Refreshed>,
): Promise<LockedRefreshOutcome<Refreshed>> {
  const stored = await readStoredCredential(accountId);
  if (!stored.ok) return { kind: "unavailable", message: stored.message };
  const freshToken = selectFreshAccessToken(stored.credential);
  if (freshToken) return { kind: "stored_token_fresh", accessToken: freshToken };
  return { kind: "refreshed", value: await refreshStoredCredential(stored.credential) };
}

async function tryAcquireRefreshLock(lockKey: string): Promise<LockAttempt> {
  const ownerId = randomUUID();
  try {
    const reply = await redis.set(lockKey, ownerId, { nx: true, px: LOCK_TTL_MS });
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
    // The lock expires on its own after LOCK_TTL_MS, and waiters return
    // the saved token without needing it.
    console.error(
      `[releaseRefreshLock] Release failed for ${lockKey}:`,
      error instanceof Error ? error.message : error,
    );
  }
}

// The two sleep helpers in the codebase are file-local (client polling, x402
// broadcast), so this module keeps its own.
function waitFor(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
