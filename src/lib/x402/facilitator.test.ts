import { describe, expect, mock, test } from "bun:test";

import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse } from "@x402/core/types";

import type { RefundSendResult } from "./chain/refundSender";
import type { NetworkConfig } from "./networks";

mock.module("server-only", () => ({}));

let settleReply: SettleResponse;
let refundSendResult: RefundSendResult;
let confirmationCount = 0;

mock.module("@/lib/x402/facilitatorClient", () => ({
  getFacilitatorClient: () => ({
    verify: async () => ({ isValid: false, invalidReason: "unused" }),
    settle: async () => settleReply,
  }),
}));

mock.module("@/lib/x402/cdp/refundCdpEvm", () => ({
  refundCdpEvm: async () => refundSendResult,
}));

mock.module("@/lib/x402/chain/confirmTransaction", () => ({
  confirmTransaction: async () => {
    confirmationCount += 1;
    return { status: "confirmed" };
  },
}));

const { refundPayment, settlePayment } = await import("./facilitator");
const { getNetworkConfig } = await import("./networks");

function requireNetwork(networkName: string): NetworkConfig {
  const network = getNetworkConfig(networkName);
  if (!network) throw new Error(`[requireNetwork] ${networkName} is missing from the network registry`);
  return network;
}

const baseNetwork = requireNetwork("base");

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: baseNetwork.caipNetwork,
  asset: baseNetwork.usdcAddress,
  amount: "10000",
  payTo: "0x0000000000000000000000000000000000000001",
  maxTimeoutSeconds: 60,
  extra: {},
};

const PAYMENT_HEADER = encodePaymentSignatureHeader({
  x402Version: 2,
  accepted: REQUIREMENTS,
  payload: {},
} satisfies PaymentPayload);

const SETTLE_TX_HASH = "0x5f1c6b3a9e2d4f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";

function settleRejectedWith(errorReason: string, transaction: string) {
  settleReply = {
    success: false,
    errorReason,
    errorMessage: "balance too low",
    transaction,
    network: baseNetwork.caipNetwork,
  };
  return settlePayment({ paymentHeader: PAYMENT_HEADER, network: baseNetwork, requirements: REQUIREMENTS });
}

describe("settlePayment on a rejected settlement", () => {
  test("a definitive reason with no transaction marks the payment as not settled", async () => {
    const settleResult = await settleRejectedWith("invalid_exact_evm_insufficient_balance", "");

    expect(settleResult).toEqual({ ok: false, error: { kind: "insufficient_funds", message: "balance too low" } });
  });

  test("a definitive reason that names a transaction is indeterminate and keeps the transaction for reconciliation", async () => {
    const settleResult = await settleRejectedWith("invalid_exact_evm_insufficient_balance", SETTLE_TX_HASH);

    expect(settleResult.ok).toBe(false);
    expect(settleResult).toMatchObject({ error: { kind: "facilitator_error", transaction: SETTLE_TX_HASH } });
  });
});

describe("refundPayment", () => {
  function refundOnBase() {
    return refundPayment({
      payerAddress: "0x00000000000000000000000000000000000000aa",
      amountUsdc: 0.01,
      network: baseNetwork,
      reason: "Could not dispatch the post.",
      idempotencyKey: "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f",
    });
  }

  test("a send with an unknown outcome is reported as such, not as a failure, and nothing waits on-chain", async () => {
    confirmationCount = 0;
    refundSendResult = {
      status: "outcome_unknown",
      txHash: null,
      message: "CDP refund send on Base did not answer within 15000 ms.",
    };

    const refundResult = await refundOnBase();

    expect(refundResult).toEqual({
      status: "send_unknown",
      refundTxHash: null,
      message: "CDP refund send on Base did not answer within 15000 ms.",
    });
    expect(confirmationCount).toBe(0);
  });

  test("a send that was refused is a failed refund with no transaction", async () => {
    refundSendResult = { status: "not_sent", message: "CDP answered 400" };

    expect(await refundOnBase()).toEqual({ status: "failed", refundTxHash: null, message: "CDP answered 400" });
  });
});
