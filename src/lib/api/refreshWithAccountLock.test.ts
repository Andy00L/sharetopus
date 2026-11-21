import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { drizzle } from "drizzle-orm/postgres-js";

import { createSocialAccountRowFake } from "@/lib/api/socialAccountRowFake";

import type { LockedCredential, RefreshTokenRotation, StoredCredential } from "./refreshWithAccountLock";

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

mock.module("server-only", () => ({}));

type FakeLockKey = { ownerId: string; expiresAtMs: number };

function createLockRedisFake() {
  const lockKeys = new Map<string, FakeLockKey>();
  const cutOffOwnerIds = new Set<string>();
  let isExtendFailing = false;
  let extendCount = 0;

  function readLiveKey(lockKey: string): FakeLockKey | null {
    const liveKey = lockKeys.get(lockKey);
    if (!liveKey || Date.now() >= liveKey.expiresAtMs) {
      lockKeys.delete(lockKey);
      return null;
    }
    return liveKey;
  }

  function runOwnerCheckedScript(script: string, lockKey: string, scriptArgs: string[]): number {
    const [ownerId, ttlMs] = scriptArgs;
    const liveKey = readLiveKey(lockKey);
    if (script.includes('redis.call("pexpire"')) {
      extendCount += 1;
      if (isExtendFailing) throw new Error("fetch failed: Upstash timeout");
      if (liveKey?.ownerId !== ownerId) return 0;
      liveKey.expiresAtMs = Date.now() + Number(ttlMs);
      return 1;
    }
    if (script.includes('redis.call("del"')) {
      if (liveKey?.ownerId !== ownerId) return 0;
      lockKeys.delete(lockKey);
      return 1;
    }
    throw new Error(`[runOwnerCheckedScript] Unexpected script: ${script}`);
  }

  return {
    redis: {
      set: async (lockKey: string, ownerId: string, lockOptions: { nx: true; px: number }) => {
        if (cutOffOwnerIds.has(ownerId)) return new Promise<never>(() => undefined);
        if (readLiveKey(lockKey)) return null;
        lockKeys.set(lockKey, { ownerId, expiresAtMs: Date.now() + lockOptions.px });
        return "OK";
      },
      eval: async (script: string, scriptKeys: string[], scriptArgs: string[]) => {
        if (cutOffOwnerIds.has(scriptArgs[0])) return new Promise<never>(() => undefined);
        return runOwnerCheckedScript(script, scriptKeys[0], scriptArgs);
      },
    },
    readOwnerId: (lockKey: string) => readLiveKey(lockKey)?.ownerId ?? null,
    readTtlMs: (lockKey: string) => {
      const liveKey = readLiveKey(lockKey);
      return liveKey ? liveKey.expiresAtMs - Date.now() : null;
    },
    placeKey: (lockKey: string, ownerId: string, ttlMs: number) => {
      lockKeys.set(lockKey, { ownerId, expiresAtMs: Date.now() + ttlMs });
    },
    cutOffOwner: (ownerId: string) => cutOffOwnerIds.add(ownerId),
    failExtends: () => {
      isExtendFailing = true;
    },
    countExtends: () => extendCount,
    reset: () => {
      lockKeys.clear();
      cutOffOwnerIds.clear();
      isExtendFailing = false;
      extendCount = 0;
    },
  };
}

const lockRedis = createLockRedisFake();
mock.module("@/actions/api/upstash", () => ({ redis: lockRedis.redis }));

const accountTable = createSocialAccountRowFake();
let firstQueryDelayMs = 0;

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async (query: Parameters<typeof accountTable.runQuery>[0]) => {
    const delayMs = firstQueryDelayMs;
    firstQueryDelayMs = 0;
    if (delayMs > 0) await sleep(delayMs);
    return accountTable.runQuery(query);
  },
}));

const { refreshWithAccountLock } = await import("./refreshWithAccountLock");
const { TOKEN_REFRESH_LOCK_TTL_MS } = await import("@/lib/api/_shared/platformFetchTimeouts");
const { RUNTIME } = await import("@/lib/jobs/runtimeConfig");

const ACCOUNT_ID = "account-1";
const LOCK_KEY = `token_refresh_lock:${ACCOUNT_ID}`;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const FUNCTION_MAX_DURATION_MS = RUNTIME.maxDurationS * 1000;
const SLOW_PLATFORM_CALL_MS = 20_000;
const CLOCK_STEP_MS = 100;
const MICROTASK_FLUSH_ROUNDS = 50;

type StoreOutcomeKind = Awaited<ReturnType<LockedCredential["storeCredential"]>>["kind"];

async function flushMicrotasks(): Promise<void> {
  for (let round = 0; round < MICROTASK_FLUSH_ROUNDS; round++) await Promise.resolve();
}

async function advanceClockBy(durationMs: number): Promise<void> {
  await flushMicrotasks();
  for (let elapsedMs = 0; elapsedMs < durationMs; elapsedMs += CLOCK_STEP_MS) {
    jest.advanceTimersByTime(Math.min(CLOCK_STEP_MS, durationMs - elapsedMs));
    await flushMicrotasks();
  }
}

async function runClockUntilSettled<Result>(pending: Promise<Result>): Promise<Result> {
  let isSettled = false;
  const settled = pending.finally(() => {
    isSettled = true;
  });
  settled.catch(() => undefined);
  await flushMicrotasks();
  for (let elapsedMs = 0; !isSettled && elapsedMs <= FUNCTION_MAX_DURATION_MS * 2; elapsedMs += CLOCK_STEP_MS) {
    await advanceClockBy(CLOCK_STEP_MS);
  }
  expect(isSettled).toBe(true);
  return settled;
}

function buildCredential(accessToken: string, expiresInMs: number): StoredCredential {
  return {
    access_token: accessToken,
    refresh_token: "rt-1",
    token_expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  };
}

function resetAccountRow(credential: StoredCredential): void {
  accountTable.reset({ id: ACCOUNT_ID, platform: "x", is_available: true, ...credential });
}

let platformCallCount = 0;
let refreshedFrom: StoredCredential[] = [];

async function recordRefresh({ stored }: LockedCredential): Promise<string> {
  refreshedFrom.push(stored);
  return "new-token";
}

function refreshAndStoreAfter(platformCallMs: number) {
  return async ({ storeCredential }: LockedCredential): Promise<StoreOutcomeKind> => {
    platformCallCount += 1;
    await sleep(platformCallMs);
    const storeOutcome = await storeCredential({
      access_token: "at-2",
      refresh_token: "rt-2",
      token_expires_at: new Date(Date.now() + 2 * HOUR_MS).toISOString(),
    });
    return storeOutcome.kind;
  };
}

function buildLockInput<Refreshed>(
  refreshTokenRotation: RefreshTokenRotation,
  refreshStoredCredential: (locked: LockedCredential) => Promise<Refreshed>,
  window: { refreshIfExpiringWithinMs?: number } = {},
) {
  return { accountId: ACCOUNT_ID, refreshTokenRotation, refreshStoredCredential, ...window };
}

beforeEach(() => {
  jest.useFakeTimers();
  lockRedis.reset();
  resetAccountRow(buildCredential("at-1", -HOUR_MS));
  firstQueryDelayMs = 0;
  platformCallCount = 0;
  refreshedFrom = [];
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("refreshWithAccountLock refresh window", () => {
  test("the lock holder keeps a token that expires in 3 days by default and refreshes it under a 7-day window", async () => {
    const expiresInThreeDays = buildCredential("stored-token", 3 * DAY_MS);
    resetAccountRow(expiresInThreeDays);

    expect(await runClockUntilSettled(refreshWithAccountLock(buildLockInput("stable", recordRefresh)))).toEqual({
      kind: "stored_token_fresh",
      accessToken: "stored-token",
    });
    expect(refreshedFrom).toEqual([]);

    expect(
      await runClockUntilSettled(
        refreshWithAccountLock(buildLockInput("stable", recordRefresh, { refreshIfExpiringWithinMs: SEVEN_DAYS_MS })),
      ),
    ).toEqual({ kind: "refreshed", value: "new-token" });
    expect(refreshedFrom).toEqual([expiresInThreeDays]);
  });

  test("a waiter under a 7-day window does not settle for a token that expires in 3 days", async () => {
    lockRedis.placeKey(LOCK_KEY, "other-run", 1_000);
    resetAccountRow(buildCredential("stored-token", 3 * DAY_MS));

    expect(
      await runClockUntilSettled(
        refreshWithAccountLock(buildLockInput("stable", recordRefresh, { refreshIfExpiringWithinMs: SEVEN_DAYS_MS })),
      ),
    ).toEqual({ kind: "refreshed", value: "new-token" });
    expect(refreshedFrom).toHaveLength(1);
  });

  test("a waiter under a 7-day window returns the token another run saved beyond it", async () => {
    lockRedis.placeKey(LOCK_KEY, "other-run", 1_000);
    resetAccountRow(buildCredential("saved-by-other-run", 60 * DAY_MS));

    expect(
      await runClockUntilSettled(
        refreshWithAccountLock(buildLockInput("stable", recordRefresh, { refreshIfExpiringWithinMs: SEVEN_DAYS_MS })),
      ),
    ).toEqual({ kind: "stored_token_fresh", accessToken: "saved-by-other-run" });
    expect(refreshedFrom).toEqual([]);
  });
});

describe("refreshWithAccountLock lease renewal", () => {
  test("a crashed holder's lock frees within one TTL of the crash, and the next refresh runs", async () => {
    let crashedAtMs = 0;
    let crashedOwnerId = "";
    void refreshWithAccountLock(
      buildLockInput("rotating", async () => {
        await sleep(SLOW_PLATFORM_CALL_MS);
        crashedAtMs = Date.now();
        crashedOwnerId = lockRedis.readOwnerId(LOCK_KEY) ?? "";
        lockRedis.cutOffOwner(crashedOwnerId);
        return new Promise<never>(() => undefined);
      }),
    );
    await advanceClockBy(SLOW_PLATFORM_CALL_MS);
    expect(crashedOwnerId).not.toBe("");

    const nextRefresh = refreshWithAccountLock(buildLockInput("rotating", refreshAndStoreAfter(1_000)));
    await advanceClockBy(crashedAtMs + TOKEN_REFRESH_LOCK_TTL_MS - Date.now());

    expect(lockRedis.readOwnerId(LOCK_KEY)).not.toBe(crashedOwnerId);
    expect(await runClockUntilSettled(nextRefresh)).toEqual({ kind: "refreshed", value: "stored" });
    expect(accountTable.readRow()).toMatchObject({ refresh_token: "rt-2" });
  });

  test.each<RefreshTokenRotation>(["rotating", "stable"])(
    "a live %s holder keeps its lock past one TTL by renewing it, so a second run waits and uses its token",
    async (refreshTokenRotation) => {
      const holderWorkMs = 100_000;
      const checkpointMs = 5_000;
      const holder = refreshWithAccountLock(buildLockInput(refreshTokenRotation, refreshAndStoreAfter(holderWorkMs)));
      await flushMicrotasks();
      const holderOwnerId = lockRedis.readOwnerId(LOCK_KEY);
      let secondRun: Promise<unknown> | null = null;

      for (let elapsedMs = checkpointMs; elapsedMs < holderWorkMs; elapsedMs += checkpointMs) {
        await advanceClockBy(checkpointMs);
        expect(lockRedis.readOwnerId(LOCK_KEY)).toBe(holderOwnerId);
        expect(lockRedis.readTtlMs(LOCK_KEY)).toBeLessThanOrEqual(TOKEN_REFRESH_LOCK_TTL_MS);
        if (elapsedMs === 60_000) {
          secondRun = refreshWithAccountLock(buildLockInput(refreshTokenRotation, refreshAndStoreAfter(1_000)));
        }
      }

      expect(await runClockUntilSettled(holder)).toEqual({ kind: "refreshed", value: "stored" });
      expect(await runClockUntilSettled(secondRun ?? Promise.resolve(null))).toEqual({
        kind: "stored_token_fresh",
        accessToken: "at-2",
      });
      expect(platformCallCount).toBe(1);
    },
  );

  test("a holder whose renewals fail does not start the platform call once its lease is too short, and asks to retry later", async () => {
    lockRedis.failExtends();
    firstQueryDelayMs = 25_000;

    const outcome = await runClockUntilSettled(
      refreshWithAccountLock(buildLockInput("rotating", refreshAndStoreAfter(1_000))),
    );

    expect(outcome).toEqual({ kind: "unavailable", message: expect.stringContaining("lapses too soon") });
    expect(platformCallCount).toBe(0);
  });

  test("a holder whose renewals fail never stores after its confirmed lease ends", async () => {
    lockRedis.failExtends();
    accountTable.setHooks({
      beforeStoreApplies: async () => {
        await sleep(TOKEN_REFRESH_LOCK_TTL_MS - SLOW_PLATFORM_CALL_MS);
        return "commit";
      },
    });

    const outcome = await runClockUntilSettled(
      refreshWithAccountLock(buildLockInput("rotating", refreshAndStoreAfter(SLOW_PLATFORM_CALL_MS))),
    );

    expect(outcome).toEqual({ kind: "refreshed", value: "failed" });
    expect(accountTable.readRow()).toMatchObject({ access_token: "at-1", refresh_token: "rt-1" });
    expect(lockRedis.countExtends()).toBeGreaterThan(0);
  });

  test("a holder whose renewal finds another owner stops storing at once", async () => {
    const holder = refreshWithAccountLock(
      buildLockInput("rotating", refreshAndStoreAfter(SLOW_PLATFORM_CALL_MS)),
    );
    await advanceClockBy(10_000);
    lockRedis.placeKey(LOCK_KEY, "run-that-took-the-lost-lock", TOKEN_REFRESH_LOCK_TTL_MS);

    const outcome = await runClockUntilSettled(holder);

    expect(outcome).toEqual({ kind: "refreshed", value: "failed" });
    expect(accountTable.readRow()).toMatchObject({ access_token: "at-1", refresh_token: "rt-1" });
  });

  test.each([
    {
      exit: "succeeds",
      refreshStoredCredential: async () => {
        await sleep(SLOW_PLATFORM_CALL_MS);
        return "token stored";
      },
      expectedOutcome: { kind: "refreshed", value: "token stored" },
    },
    {
      exit: "is refused by the platform",
      refreshStoredCredential: async () => {
        await sleep(SLOW_PLATFORM_CALL_MS);
        return "refresh refused";
      },
      expectedOutcome: { kind: "refreshed", value: "refresh refused" },
    },
    {
      exit: "throws",
      refreshStoredCredential: async (): Promise<string> => {
        await sleep(SLOW_PLATFORM_CALL_MS);
        throw new Error("platform client crashed");
      },
      expectedOutcome: { thrown: "platform client crashed" },
    },
  ])("the holder renews while the refresh runs and stops renewing when it $exit", async ({ refreshStoredCredential, expectedOutcome }) => {
    const outcome = await runClockUntilSettled(
      refreshWithAccountLock(buildLockInput("rotating", refreshStoredCredential)),
    ).then(
      (lockOutcome) => lockOutcome,
      (error: unknown) => ({ thrown: error instanceof Error ? error.message : String(error) }),
    );
    expect(outcome).toEqual(expectedOutcome);
    const extendsAtReturn = lockRedis.countExtends();

    expect(extendsAtReturn).toBeGreaterThan(0);
    expect(jest.getTimerCount()).toBe(0);
    await advanceClockBy(2 * TOKEN_REFRESH_LOCK_TTL_MS);
    expect(lockRedis.countExtends()).toBe(extendsAtReturn);
    expect(lockRedis.readOwnerId(LOCK_KEY)).toBeNull();
  });

  test("a holder stuck for as long as a function can run stops renewing, so its lock frees by then", async () => {
    const lockRequestedAtMs = Date.now();
    void refreshWithAccountLock(buildLockInput("rotating", () => new Promise<never>(() => undefined)));

    await advanceClockBy(FUNCTION_MAX_DURATION_MS);

    expect(Date.now() - lockRequestedAtMs).toBe(FUNCTION_MAX_DURATION_MS);
    expect(lockRedis.readOwnerId(LOCK_KEY)).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
  });
});
