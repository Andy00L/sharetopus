import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { VerifyUsdcPaymentResult } from "./verifyUsdcPayment";

mock.module("server-only", () => ({}));

const PAYER_ADDRESS = "So11111111111111111111111111111111111111112";
const RECIPIENT_ADDRESS = "SysvarRent111111111111111111111111111111111";
const TX_SIGNATURE = "5h6xBEauJ3PK6SWCZ1PGjBvj8vDdWG3KpwATGy1ARAXFSDwt8GFXM7W5Ncn16wmqokgpiKRLuS83KUxyZyv2sUYv";
const ACCOUNT_ID = "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f";
const CACHED_PRICE_USDC = 0.25;
const FRESH_PRICE_USDC = 0.5;

process.env.X402_RECIPIENT_SOLANA = RECIPIENT_ADDRESS;

type UnchargedPayment = {
  txHash: string;
  payerAddress: string;
  amountAtomic: string;
  network: string;
};

let verificationResult: VerifyUsdcPaymentResult;
let requiredAtomicAmounts: bigint[] = [];
let recordedUnchargedPayments: UnchargedPayment[] = [];
let chargeReconciliationCount = 0;
let chargeInsertCount = 0;
let postBatchCount = 0;

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => ({ data: [], error: null }),
}));

mock.module("@/lib/x402/pricing/readActionPrice", () => ({
  readActionPrice: async () => ({ ok: true, usdcPrice: CACHED_PRICE_USDC }),
  readFreshActionPrice: async () => ({ ok: true, usdcPrice: FRESH_PRICE_USDC }),
}));

mock.module("@/lib/solanaActions/verifyUsdcPayment", () => ({
  verifyUsdcPayment: async (params: { minimumAtomicAmount: bigint }) => {
    requiredAtomicAmounts.push(params.minimumAtomicAmount);
    return verificationResult;
  },
}));

mock.module("@/lib/x402/charges/recordReconciliation", () => ({
  recordX402Reconciliation: async () => {
    chargeReconciliationCount += 1;
  },
  recordUnchargedPayment: async (entry: UnchargedPayment) => {
    recordedUnchargedPayments.push(entry);
  },
}));

mock.module("@/lib/x402/charges/insertPendingX402Charge", () => ({
  insertPendingX402Charge: async () => {
    chargeInsertCount += 1;
    return { success: false, message: "unused", conflictReason: "db_error" };
  },
}));

mock.module("@/actions/server/directPostActions/directPostBatch", () => ({
  directPostBatch: async () => {
    postBatchCount += 1;
    return { success: false, message: "unused" };
  },
}));

mock.module("@/lib/x402/auth/resolveOrOnboardWalletPrincipal", () => ({
  resolveExistingWalletPrincipal: async () => ({ ok: false, reason: "db_error", message: "unused" }),
}));

mock.module("@/lib/x402/charges/chargeLifecycle", () => ({
  refundCharge: async () => ({ refundInitiated: false, refundTxHash: null }),
  updateChargeRecord: async () => {},
}));

mock.module("@/lib/x402/charges/chargeTransitions", () => ({
  markChargeSettled: async () => ({ success: false, reason: "db_error", message: "unused" }),
}));

const { confirmPostNowPayment } = await import("./postNowBlink");

function confirmPayment() {
  return confirmPostNowPayment({
    target: { accountId: ACCOUNT_ID, platform: "linkedin" },
    text: "Hello",
    payerAddressRaw: PAYER_ADDRESS,
    txSignatureRaw: TX_SIGNATURE,
  });
}

function buildUnderpayment(atomicReceived: bigint): VerifyUsdcPaymentResult {
  return {
    ok: false,
    reason: "amount_short",
    message: `The transaction paid ${atomicReceived} atomic USDC; 500000 was required.`,
    txSignature: TX_SIGNATURE,
    payerAddress: PAYER_ADDRESS,
    atomicReceived,
  };
}

beforeEach(() => {
  requiredAtomicAmounts = [];
  recordedUnchargedPayments = [];
  chargeReconciliationCount = 0;
  chargeInsertCount = 0;
  postBatchCount = 0;
});

describe("confirming a Blink payment", () => {
  test("checks the payment against the database price, not an instance's cached one", async () => {
    verificationResult = buildUnderpayment(BigInt(250_000));

    await confirmPayment();

    expect(requiredAtomicAmounts).toEqual([BigInt(500_000)]);
  });

  test("a payment under the current price is recorded for a manual refund and posts nothing", async () => {
    verificationResult = buildUnderpayment(BigInt(250_000));

    const confirmation = await confirmPayment();

    expect(confirmation.ok).toBe(false);
    expect(confirmation).toMatchObject({ httpStatus: 402 });
    expect(confirmation.ok ? "" : confirmation.message).toContain("recorded for a manual refund");
    expect(recordedUnchargedPayments).toEqual([
      { txHash: TX_SIGNATURE, payerAddress: PAYER_ADDRESS, amountAtomic: "250000", network: "solana" },
    ]);
    expect(chargeReconciliationCount).toBe(0);
    expect(chargeInsertCount).toBe(0);
    expect(postBatchCount).toBe(0);
  });

  test("a transaction that credited nothing records no reconciliation row", async () => {
    verificationResult = buildUnderpayment(BigInt(0));

    const confirmation = await confirmPayment();

    expect(confirmation).toMatchObject({ ok: false, httpStatus: 402 });
    expect(recordedUnchargedPayments).toEqual([]);
  });
});
