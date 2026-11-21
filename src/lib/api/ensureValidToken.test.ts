import { afterEach, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/postgres-js";

import type { SocialAccount } from "@/lib/types/dbTypes";

import { createSocialAccountRowFake, type FakeAccountRow } from "./socialAccountRowFake";

process.env.SOCIAL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");

mock.module("server-only", () => ({}));

const ACCOUNT_ID = "account-x";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const SEVEN_DAYS_MS = 7 * DAY_MS;
const X_ACCESS_TOKEN_LIFETIME_SECONDS = 2 * 60 * 60;
const LINKEDIN_ACCESS_TOKEN_LIFETIME_SECONDS = 60 * 24 * 60 * 60;
const EXPIRED_AT = "2026-11-21T08:00:00.000Z";

const accountTable = createSocialAccountRowFake();
let validRefreshToken: string;
let issuedTokenNumber: number;
let lockCallCount: number;
let acquireLock: (lockCallNumber: number) => Promise<"OK" | null>;
let afterRefreshSpent: () => void;
let beforeRefusal: () => void;
let spentRefreshTokens: string[];
let lockTtlsMs: number[];

mock.module("@/db/client", () => ({ db: drizzle.mock(), runQuery: accountTable.runQuery }));

mock.module("@/actions/api/upstash", () => ({
  redis: {
    set: async (_lockKey: string, _ownerId: string, lockOptions: { px: number }) => {
      lockTtlsMs.push(lockOptions.px);
      return acquireLock(++lockCallCount);
    },
    eval: async () => 1,
  },
}));

mock.module("@/lib/api/x/data/refreshXToken", () => ({
  default: async (refreshToken: string) => {
    spentRefreshTokens.push(refreshToken);
    afterRefreshSpent();
    if (refreshToken !== validRefreshToken) {
      beforeRefusal();
      return { kind: "rejected", message: "invalid_request: refresh token invalid" };
    }
    issuedTokenNumber += 1;
    validRefreshToken = `rt-${issuedTokenNumber}`;
    return {
      kind: "refreshed",
      tokens: {
        access_token: `at-${issuedTokenNumber}`,
        refresh_token: `rt-${issuedTokenNumber}`,
        expires_in: X_ACCESS_TOKEN_LIFETIME_SECONDS,
      },
    };
  },
}));

mock.module("@/lib/api/linkedin/data/refreshLinkedinToken", () => ({
  default: async (refreshToken: string) => {
    spentRefreshTokens.push(refreshToken);
    return {
      kind: "refreshed",
      tokens: {
        access_token: "linkedin-at-2",
        refresh_token: refreshToken,
        expires_in: LINKEDIN_ACCESS_TOKEN_LIFETIME_SECONDS,
      },
    };
  },
}));

const { ensureValidToken } = await import("./ensureValidToken");
const { TOKEN_REFRESH_LOCK_TTL_MS } = await import("@/lib/api/_shared/platformFetchTimeouts");
const { RUNTIME } = await import("@/lib/jobs/runtimeConfig");
const FUNCTION_MAX_DURATION_MS = RUNTIME.maxDurationS * 1000;

function buildAccount(tokenExpiresAt: string, platform: SocialAccount["platform"] = "x"): SocialAccount {
  return {
    id: ACCOUNT_ID,
    principal_id: "principal-1",
    platform,
    account_identifier: "identifier-1",
    display_name: "Account One",
    username: "account_one",
    email_address: null,
    avatar_url: null,
    is_verified: null,
    follower_count: null,
    following_count: null,
    bio_description: null,
    is_available: true,
    connection_id: null,
    extra: {},
    created_at: "2026-11-20T00:00:00.000Z",
    updated_at: "2026-11-20T00:00:00.000Z",
    deleted_at: null,
    access_token: "at-1",
    refresh_token: "rt-1",
    token_expires_at: tokenExpiresAt,
  };
}

function buildAccountRow(credential: Pick<FakeAccountRow, "access_token" | "refresh_token" | "token_expires_at">): FakeAccountRow {
  return { id: ACCOUNT_ID, platform: "x", is_available: true, ...credential };
}

function loseLockAfter(firstSpend: Promise<void>): void {
  acquireLock = async (lockCallNumber) => {
    if (lockCallNumber === 1) return "OK";
    await firstSpend;
    return "OK";
  };
}

function failEveryLockCall(): void {
  acquireLock = async () => {
    throw new Error("fetch failed: Upstash timeout");
  };
}

function holdStoreUntilRefusedRunRereads(options: { failRereadAfterFlag: boolean }): void {
  const firstSpend = Promise.withResolvers<void>();
  const settleReread = Promise.withResolvers<void>();
  const winnerStored = Promise.withResolvers<void>();
  let isRefused = false;
  let selectsAfterRefusal = 0;
  loseLockAfter(firstSpend.promise);
  afterRefreshSpent = () => firstSpend.resolve();
  beforeRefusal = () => {
    isRefused = true;
  };
  accountTable.setHooks({
    afterSelect: () => {
      if (!isRefused) return;
      selectsAfterRefusal += 1;
      settleReread.resolve();
    },
    failSelect: () => options.failRereadAfterFlag && selectsAfterRefusal >= 2,
    beforeStoreApplies: async () => {
      await settleReread.promise;
      return "commit";
    },
    afterStoreApplies: async () => winnerStored.resolve(),
    beforeFlagApplies: () => winnerStored.promise,
  });
}

beforeEach(() => {
  accountTable.reset(
    buildAccountRow({ access_token: "at-1", refresh_token: "rt-1", token_expires_at: EXPIRED_AT }),
  );
  validRefreshToken = "rt-1";
  issuedTokenNumber = 1;
  lockCallCount = 0;
  acquireLock = async () => "OK";
  afterRefreshSpent = () => undefined;
  beforeRefusal = () => undefined;
  spentRefreshTokens = [];
  lockTtlsMs = [];
});

afterEach(() => {
  setSystemTime();
});

describe("ensureValidToken refresh lease", () => {
  test("an X refresh holds its lock as long as a function can run, a LinkedIn refresh keeps the 45 s lock", async () => {
    await ensureValidToken(buildAccount(EXPIRED_AT));
    accountTable.reset(
      buildAccountRow({ access_token: "at-1", refresh_token: "rt-1", token_expires_at: EXPIRED_AT }),
    );
    await ensureValidToken(buildAccount(EXPIRED_AT, "linkedin"));

    expect(lockTtlsMs).toEqual([FUNCTION_MAX_DURATION_MS, TOKEN_REFRESH_LOCK_TTL_MS]);
  });

  test("an X holder whose read outlasts its lease does not start the refresh and asks to retry later", async () => {
    accountTable.setHooks({
      afterSelect: () => setSystemTime(Date.now() + FUNCTION_MAX_DURATION_MS),
    });

    const tokenResult = await ensureValidToken(buildAccount(EXPIRED_AT));

    expect(tokenResult).toMatchObject({ success: false, failureReason: "transient" });
    expect(spentRefreshTokens).toEqual([]);
  });

  test("a store the database runs after the lease ended never lands, so a reconnect answer means a dead token", async () => {
    const postSpent = Promise.withResolvers<void>();
    const cronAnswered = Promise.withResolvers<void>();
    const leaseEndedAtMs = Date.now() + FUNCTION_MAX_DURATION_MS + 1_000;
    afterRefreshSpent = () => postSpent.resolve();
    accountTable.setHooks({
      beforeStoreApplies: async () => {
        await cronAnswered.promise;
        return "commit";
      },
    });

    const postRun = ensureValidToken(buildAccount(EXPIRED_AT));
    await postSpent.promise;
    setSystemTime(leaseEndedAtMs);
    const cronResult = await ensureValidToken(buildAccount(EXPIRED_AT), {
      refreshIfExpiringWithinMs: SEVEN_DAYS_MS,
    });
    cronAnswered.resolve();
    const postResult = await postRun;

    expect(spentRefreshTokens).toEqual(["rt-1", "rt-1"]);
    expect(cronResult).toMatchObject({ success: false, failureReason: "auth_expired" });
    expect(accountTable.readRow()?.refresh_token).not.toBe(validRefreshToken);
    expect(postResult).toEqual({ success: true, token: "at-2" });
  });
});

describe("ensureValidToken when Redis cannot answer", () => {
  test("an X token is not refreshed without the lock, and the caller is asked to retry later", async () => {
    failEveryLockCall();

    const tokenResult = await ensureValidToken(buildAccount(EXPIRED_AT));

    expect(tokenResult).toEqual({
      success: false,
      error: expect.stringContaining("try again in a few minutes"),
      failureReason: "transient",
    });
    expect(spentRefreshTokens).toEqual([]);
    expect(accountTable.readRow()).toMatchObject({ refresh_token: "rt-1", is_available: true });
  });

  test("a LinkedIn token, whose refresh token does not rotate, is still refreshed without the lock", async () => {
    failEveryLockCall();

    const tokenResult = await ensureValidToken(buildAccount(EXPIRED_AT, "linkedin"));

    expect(tokenResult).toEqual({ success: true, token: "linkedin-at-2" });
    expect(spentRefreshTokens).toEqual(["rt-1"]);
    expect(accountTable.readRow()).toMatchObject({ access_token: "linkedin-at-2", refresh_token: "rt-1" });
  });
});

describe("ensureValidToken after a refused refresh", () => {
  test("a refused refresh of a token that still works flags the account instead of returning that token", async () => {
    const expiresInThreeDays = new Date(Date.now() + 3 * DAY_MS).toISOString();
    accountTable.reset(
      buildAccountRow({ access_token: "at-1", refresh_token: "rt-1", token_expires_at: expiresInThreeDays }),
    );
    validRefreshToken = "rt-revoked";

    const tokenResult = await ensureValidToken(buildAccount(expiresInThreeDays), {
      refreshIfExpiringWithinMs: SEVEN_DAYS_MS,
    });

    expect(tokenResult).toEqual({
      success: false,
      error: expect.stringContaining("needs to be reconnected"),
      failureReason: "auth_expired",
    });
    expect(accountTable.readRow()?.is_available).toBe(false);
  });

  test("a refused refresh returns the token another run saved meanwhile, without flagging", async () => {
    validRefreshToken = "rt-2";
    beforeRefusal = () =>
      accountTable.replaceRow(
        buildAccountRow({
          access_token: "at-saved-by-other-run",
          refresh_token: "rt-2",
          token_expires_at: new Date(Date.now() + 60 * DAY_MS).toISOString(),
        }),
      );

    const tokenResult = await ensureValidToken(buildAccount(EXPIRED_AT));

    expect(tokenResult).toEqual({ success: true, token: "at-saved-by-other-run" });
    expect(accountTable.readRow()?.is_available).toBe(true);
  });

  test("path F: after a lost lock, a token saved after the refused run's reread is returned, not answered with a reconnect", async () => {
    holdStoreUntilRefusedRunRereads({ failRereadAfterFlag: false });

    const [lockHolderResult, locklessResult] = await Promise.all([
      ensureValidToken(buildAccount(EXPIRED_AT)),
      ensureValidToken(buildAccount(EXPIRED_AT)),
    ]);

    expect(lockHolderResult).toEqual({ success: true, token: "at-2" });
    expect(locklessResult).toEqual({ success: true, token: "at-2" });
    expect(accountTable.readRow()).toMatchObject({ refresh_token: "rt-2", is_available: true });
  });

  test("a flag that finds the credential changed but cannot reread it asks to retry later, not to reconnect", async () => {
    holdStoreUntilRefusedRunRereads({ failRereadAfterFlag: true });

    const [, locklessResult] = await Promise.all([
      ensureValidToken(buildAccount(EXPIRED_AT)),
      ensureValidToken(buildAccount(EXPIRED_AT)),
    ]);

    expect(locklessResult).toEqual({
      success: false,
      error: expect.stringContaining("try again in a few minutes"),
      failureReason: "transient",
    });
    expect(accountTable.readRow()?.is_available).toBe(true);
  });
});

describe("ensureValidToken storing a refreshed token", () => {
  test("path G: after a lost lock, a store retried after a lost reply keeps the newer token another refresh saved", async () => {
    const postStoreCommitted = Promise.withResolvers<void>();
    const cronStored = Promise.withResolvers<void>();
    loseLockAfter(postStoreCommitted.promise);
    accountTable.setHooks({
      beforeStoreApplies: async (storeNumber) =>
        storeNumber === 1 ? "commit_and_lose_reply" : "commit",
      afterStoreApplies: async (storeNumber) => {
        if (storeNumber !== 1) return cronStored.resolve();
        postStoreCommitted.resolve();
        await cronStored.promise;
      },
    });

    const [postResult, cronResult] = await Promise.all([
      ensureValidToken(buildAccount(EXPIRED_AT)),
      ensureValidToken(buildAccount(EXPIRED_AT), { refreshIfExpiringWithinMs: SEVEN_DAYS_MS }),
    ]);

    expect(accountTable.readRow()).toMatchObject({
      access_token: "at-3",
      refresh_token: "rt-3",
      is_available: true,
    });
    expect(cronResult).toEqual({ success: true, token: "at-3" });
    expect(postResult).toEqual({ success: true, token: "at-3" });
  });
});
