import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as nextServer from "next/server";

type SettleOutcome = "settled" | "timeout" | "rejected" | "unrecorded";

type HeldSettle = { markArrived: () => void; released: Promise<void> };

const PRINCIPAL_ID = "wallet-1";
const SOCIAL_ACCOUNT_ID = "5b1f0c4e-3d2a-4f6b-8c9d-0e1f2a3b4c5d";

const ledger = {
  reservations: new Map<string, string>(),
  isRedisDown: false,
  storedKeys: new Set<string>(),
  settleAttempts: [] as string[],
  settleOutcomeByNonce: new Map<string, SettleOutcome>(),
  heldSettles: new Map<string, HeldSettle>(),
  shouldRefusePrecheckOnce: false,
  shouldFailActionOnce: false,
  isRefundConfirmed: false,
  actionRuns: 0,
  refundedChargeIds: [] as string[],
};

beforeEach(() => {
  ledger.reservations.clear();
  ledger.isRedisDown = false;
  ledger.storedKeys.clear();
  ledger.settleAttempts = [];
  ledger.settleOutcomeByNonce.clear();
  ledger.heldSettles.clear();
  ledger.shouldRefusePrecheckOnce = false;
  ledger.shouldFailActionOnce = false;
  ledger.isRefundConfirmed = false;
  ledger.actionRuns = 0;
  ledger.refundedChargeIds = [];
});

function holdSettle(nonce: string): { arrived: Promise<void>; release: () => void } {
  let markArrived: () => void = () => undefined;
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => {
    markArrived = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  ledger.heldSettles.set(nonce, { markArrived, released });
  return { arrived, release };
}

function precheckStoredKey(idempotencyKey: string | undefined, principalId: string) {
  if (ledger.shouldRefusePrecheckOnce) {
    ledger.shouldRefusePrecheckOnce = false;
    return {
      ok: false,
      httpStatus: 403,
      errorKind: "account_not_owned",
      message: "This social account does not belong to the paying wallet.",
    };
  }
  if (idempotencyKey && ledger.storedKeys.has(`${principalId}:${idempotencyKey}`)) {
    return {
      ok: false,
      httpStatus: 409,
      errorKind: "duplicate_idempotency_key",
      message: "A post with this idempotency_key already exists.",
    };
  }
  return { ok: true };
}

function runStoredAction(idempotencyKey: string | undefined, principalId: string): number {
  const storedKey = `${principalId}:${idempotencyKey}`;
  if (ledger.storedKeys.has(storedKey)) return 0;
  ledger.storedKeys.add(storedKey);
  ledger.actionRuns += 1;
  return 1;
}

mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ ...nextServer, after: () => undefined }));
mock.module("@/actions/server/rateLimit/checkRateLimit", () => ({
  checkRateLimit: async () => ({ success: true }),
}));
mock.module("@/lib/api/context", () => ({
  extractIpHash: async () => "ip-hash",
  extractUserAgent: async () => "agent",
}));
mock.module("@/lib/x402/audit/logX402Call", () => ({ logX402Call: async () => undefined }));
mock.module("@/lib/x402/auth/resolveOrOnboardWalletPrincipal", () => ({
  resolveOrOnboardWalletPrincipal: async () => ({ ok: true, principal: { principalId: PRINCIPAL_ID } }),
}));
mock.module("@/lib/x402/pricing/readActionPrice", () => ({
  readActionPrice: async () => ({ ok: true, usdcPrice: 0.05 }),
}));
mock.module("@/lib/x402/http/resolveRequestNetwork", () => ({
  resolveRequestNetwork: () => ({
    ok: true,
    network: { name: "base", caipNetwork: "eip155:8453", usdcDecimals: 6 },
    recipientAddress: "0xrecipient",
  }),
}));
mock.module("@/lib/x402/facilitator", () => ({
  verifyPayment: async (input: { paymentHeader: string }) => ({
    ok: true,
    payerAddress: "0xpayer",
    nonce: input.paymentHeader,
    requirements: { amount: "50000" },
  }),
}));
mock.module("@/lib/x402/charges/chargeLifecycle", () => ({
  settleCharge: async (input: { verified: { nonce: string } }) => {
    const nonce = input.verified.nonce;
    ledger.settleAttempts.push(nonce);
    const held = ledger.heldSettles.get(nonce);
    if (held) {
      held.markArrived();
      await held.released;
    }
    const chargeId = `charge-${nonce}`;
    switch (ledger.settleOutcomeByNonce.get(nonce) ?? "settled") {
      case "settled":
        return { ok: true, chargeId, txHash: `tx-${nonce}` };
      case "timeout":
        return {
          ok: false,
          reason: "settle_failed",
          chargeId,
          error: { kind: "timeout", message: "settle timed out" },
        };
      case "rejected":
        return {
          ok: false,
          reason: "settle_failed",
          chargeId,
          error: { kind: "insufficient_funds", message: "insufficient funds" },
        };
      case "unrecorded":
        return { ok: false, reason: "settled_unrecorded", chargeId, txHash: `tx-${nonce}` };
    }
  },
  refundCharge: async (input: { chargeId: string }) => {
    ledger.refundedChargeIds.push(input.chargeId);
    return {
      refundInitiated: true,
      refundConfirmed: ledger.isRefundConfirmed,
      refundTxHash: `refund-${input.chargeId}`,
    };
  },
  updateChargeRecord: async () => ({ ok: true }),
}));
mock.module("@/actions/api/upstash", () => ({
  redis: {
    set: async (key: string, value: string, options: { nx?: boolean }) => {
      if (ledger.isRedisDown) throw new Error("connect ECONNREFUSED");
      if (options.nx && ledger.reservations.has(key)) return null;
      ledger.reservations.set(key, value);
      return "OK";
    },
    del: async (key: string) => {
      if (ledger.isRedisDown) throw new Error("connect ECONNREFUSED");
      return ledger.reservations.delete(key) ? 1 : 0;
    },
  },
}));
mock.module("@/actions/server/directPostActions/directPostBatch", () => ({
  preflightDirectPost: async (post: { idempotency_key?: string }, principalId: string) =>
    precheckStoredKey(post.idempotency_key, principalId),
  directPostBatch: async (posts: Array<{ idempotency_key?: string }>, principalId: string) => {
    if (ledger.shouldFailActionOnce) {
      ledger.shouldFailActionOnce = false;
      return { success: false, failure: "internal", message: "Could not dispatch the post." };
    }
    const dispatched = runStoredAction(posts[0]?.idempotency_key, principalId);
    return {
      success: true,
      batchId: "batch-1",
      eventIds: ["dispatch-1"],
      details: { total: 1, dispatched, duplicates: 1 - dispatched, rejected: [] },
    };
  },
}));
mock.module("@/actions/server/scheduleActions/schedule/schedulePostBatch", () => ({
  preflightSchedulePost: async (post: { idempotency_key?: string }, principalId: string) =>
    precheckStoredKey(post.idempotency_key, principalId),
  schedulePostBatch: async (posts: Array<{ idempotency_key?: string }>, principalId: string) => {
    const inserted = runStoredAction(posts[0]?.idempotency_key, principalId);
    return {
      success: true,
      batchId: "batch-1",
      scheduleIds: ["post-1"],
      details: { total: 1, inserted, duplicates: 1 - inserted, rejected: [] },
    };
  },
}));

const postNowRoute = await import("@/app/api/x402/post-now/route");
const scheduleRoute = await import("@/app/api/x402/schedule/route");
const { KEY_RESERVATION_TTL_MS } = await import("./idempotencyKeyReservation");

const PAID_ROUTES = [
  {
    name: "post-now",
    path: "/api/x402/post-now",
    callRoute: postNowRoute.POST,
    maxDurationSeconds: postNowRoute.maxDuration,
    extraBody: {},
  },
  {
    name: "schedule",
    path: "/api/x402/schedule",
    callRoute: scheduleRoute.POST,
    maxDurationSeconds: scheduleRoute.maxDuration,
    extraBody: { scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
  },
];

type PaidRoute = (typeof PAID_ROUTES)[number];

const [POST_NOW] = PAID_ROUTES;

function callPaidRoute(paidRoute: PaidRoute, nonce: string, idempotencyKey: string): Promise<Response> {
  const body = {
    social_account_id: SOCIAL_ACCOUNT_ID,
    platform: "linkedin",
    post_type: "text",
    description: "Launch day.",
    idempotency_key: idempotencyKey,
    ...paidRoute.extraBody,
  };
  return paidRoute.callRoute(
    new nextServer.NextRequest(`https://sharetopus.test${paidRoute.path}`, {
      method: "POST",
      headers: { "payment-signature": nonce, "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

async function readErrorKind(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  return typeof body === "object" && body !== null && "error" in body ? body.error : null;
}

describe("a paid call reserves its idempotency_key before the payment settles", () => {
  for (const paidRoute of PAID_ROUTES) {
    test(`${paidRoute.name}: the reservation outlives the route's maxDuration`, () => {
      expect(paidRoute.maxDurationSeconds * 1000).toBeLessThan(KEY_RESERVATION_TTL_MS);
    });

    test(`${paidRoute.name}: a second payment for a key still in flight is refused before it settles`, async () => {
      const firstSettle = holdSettle("nonce-a");
      const firstCall = callPaidRoute(paidRoute, "nonce-a", "key-1");
      await firstSettle.arrived;

      const secondResponse = await callPaidRoute(paidRoute, "nonce-b", "key-1");
      firstSettle.release();
      const firstResponse = await firstCall;

      expect(secondResponse.status).toBe(409);
      expect(await readErrorKind(secondResponse)).toBe("idempotency_key_in_progress");
      expect(ledger.settleAttempts).toEqual(["nonce-a"]);
      expect(firstResponse.status).toBe(200);
      expect(ledger.actionRuns).toBe(1);
      expect(ledger.refundedChargeIds).toEqual([]);
    });
  }

  test("a Redis error on the reservation answers 503 and takes no payment, as the x402 rate limit does", async () => {
    ledger.isRedisDown = true;

    const response = await callPaidRoute(POST_NOW, "nonce-a", "key-1");

    expect(response.status).toBe(503);
    expect(await readErrorKind(response)).toBe("idempotency_check_unavailable");
    expect(ledger.settleAttempts).toEqual([]);
  });
});

describe("which first-call outcomes free the key for a retry with a new payment", () => {
  const FIRST_CALL_OUTCOMES = [
    {
      outcome: "the precheck refuses the account",
      prepareFirstCall: () => {
        ledger.shouldRefusePrecheckOnce = true;
      },
      retryStatus: 200,
      retryErrorKind: null,
      settleAttempts: ["nonce-2"],
    },
    {
      outcome: "the settle is rejected",
      prepareFirstCall: () => ledger.settleOutcomeByNonce.set("nonce-1", "rejected"),
      retryStatus: 200,
      retryErrorKind: null,
      settleAttempts: ["nonce-1", "nonce-2"],
    },
    {
      outcome: "the post is stored",
      prepareFirstCall: () => undefined,
      retryStatus: 409,
      retryErrorKind: "duplicate_idempotency_key",
      settleAttempts: ["nonce-1"],
    },
    {
      outcome: "the settle outcome is unknown",
      prepareFirstCall: () => ledger.settleOutcomeByNonce.set("nonce-1", "timeout"),
      retryStatus: 409,
      retryErrorKind: "idempotency_key_in_progress",
      settleAttempts: ["nonce-1"],
    },
    {
      outcome: "the payment settled but was not recorded",
      prepareFirstCall: () => ledger.settleOutcomeByNonce.set("nonce-1", "unrecorded"),
      retryStatus: 409,
      retryErrorKind: "idempotency_key_in_progress",
      settleAttempts: ["nonce-1"],
    },
    {
      outcome: "the action fails and its refund is sent but not confirmed",
      prepareFirstCall: () => {
        ledger.shouldFailActionOnce = true;
      },
      retryStatus: 409,
      retryErrorKind: "idempotency_key_in_progress",
      settleAttempts: ["nonce-1"],
    },
    {
      outcome: "the action fails and its refund is confirmed",
      prepareFirstCall: () => {
        ledger.shouldFailActionOnce = true;
        ledger.isRefundConfirmed = true;
      },
      retryStatus: 200,
      retryErrorKind: null,
      settleAttempts: ["nonce-1", "nonce-2"],
    },
  ];

  for (const firstCall of FIRST_CALL_OUTCOMES) {
    test(`after ${firstCall.outcome}, the retry answers ${firstCall.retryStatus}${firstCall.retryErrorKind ? ` ${firstCall.retryErrorKind}` : ""}`, async () => {
      firstCall.prepareFirstCall();
      await callPaidRoute(POST_NOW, "nonce-1", "key-1");

      const retryResponse = await callPaidRoute(POST_NOW, "nonce-2", "key-1");

      expect(retryResponse.status).toBe(firstCall.retryStatus);
      if (firstCall.retryErrorKind) {
        expect(await readErrorKind(retryResponse)).toBe(firstCall.retryErrorKind);
      }
      expect(ledger.settleAttempts).toEqual(firstCall.settleAttempts);
    });
  }
});
