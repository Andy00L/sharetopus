import { describe, expect, mock, test } from "bun:test";

import { encodePaymentSignatureHeader } from "@x402/core/http";
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from "@x402/core/types";

import type { RefundSendResult } from "./chain/refundSender";
import type { NetworkConfig } from "./networks";

mock.module("server-only", () => ({}));

let settleReply: SettleResponse;
let verifyReply: VerifyResponse = { isValid: false, invalidReason: "unused" };
let refundSendResult: RefundSendResult;
let confirmationCount = 0;

mock.module("@/lib/x402/facilitatorClient", () => ({
  getFacilitatorClient: () => ({
    ok: true,
    client: {
      verify: async () => verifyReply,
      settle: async () => settleReply,
    },
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

const { refundPayment, settlePayment, verifyPayment } = await import("./facilitator");
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

describe("verifyPayment on a refusal that can mean the payment was already used", () => {
  const SIGNED_PAYER = "0x00000000000000000000000000000000000000aa";
  const AUTHORIZATION_NONCE = "0x9a4d000000000000000000000000000000000000000000000000000000000001";
  const RECIPIENT = "0x0000000000000000000000000000000000000001";
  const SPENT_PAYMENT = { nonce: AUTHORIZATION_NONCE, payerAddress: SIGNED_PAYER };

  function refuseVerify(params: { networkName: string; invalidReason: string; payer?: string }) {
    const network = requireNetwork(params.networkName);
    verifyReply = { isValid: false, invalidReason: params.invalidReason, payer: params.payer };
    const paymentHeader = encodePaymentSignatureHeader({
      x402Version: 2,
      accepted: { ...REQUIREMENTS, network: network.caipNetwork, asset: network.usdcAddress, payTo: RECIPIENT },
      payload: {
        signature: "0x01",
        authorization: {
          from: SIGNED_PAYER,
          to: RECIPIENT,
          value: "10000",
          validAfter: "0",
          validBefore: "1758170309",
          nonce: AUTHORIZATION_NONCE,
        },
      },
    } satisfies PaymentPayload);
    return verifyPayment({ paymentHeader, amountUsdc: 0.01, recipientAddress: RECIPIENT, network });
  }

  const SPENT_REFUSALS = [
    {
      facilitator: "Arc, @x402/evm",
      networkName: "arc",
      invalidReason: "invalid_exact_evm_nonce_already_used",
      payer: SIGNED_PAYER,
      expectedError: { kind: "replay_detected", nonce: AUTHORIZATION_NONCE, payment: SPENT_PAYMENT },
    },
    {
      facilitator: "Arc, @x402/evm",
      networkName: "arc",
      invalidReason: "invalid_exact_evm_payload_authorization_valid_before",
      payer: SIGNED_PAYER,
      expectedError: { kind: "authorization_expired", payment: SPENT_PAYMENT },
    },
    {
      facilitator: "CDP",
      networkName: "base",
      invalidReason: "invalid_payload",
      payer: undefined,
      expectedError: { kind: "invalid_payment", payment: SPENT_PAYMENT },
    },
    {
      facilitator: "CDP",
      networkName: "base",
      invalidReason: "duplicate_settlement",
      payer: undefined,
      expectedError: { kind: "replay_detected", payment: SPENT_PAYMENT },
    },
    {
      facilitator: "Celo, x402-rs",
      networkName: "celo",
      invalidReason: "transaction_simulation",
      payer: SIGNED_PAYER,
      expectedError: { kind: "invalid_payment", payment: SPENT_PAYMENT },
    },
    {
      facilitator: "Celo, x402-rs",
      networkName: "celo",
      invalidReason: "invalid_payment_expired",
      payer: SIGNED_PAYER,
      expectedError: { kind: "authorization_expired", payment: SPENT_PAYMENT },
    },
  ];

  for (const refusal of SPENT_REFUSALS) {
    test(`${refusal.facilitator}: ${refusal.invalidReason} is ${refusal.expectedError.kind} and names the payment`, async () => {
      const verifyResult = await refuseVerify(refusal);

      expect(verifyResult).toMatchObject({ ok: false, error: refusal.expectedError });
    });
  }

  test("a facilitator payer that differs from the signed payer names no payment", async () => {
    const verifyResult = await refuseVerify({
      networkName: "arc",
      invalidReason: "invalid_exact_evm_nonce_already_used",
      payer: "0x00000000000000000000000000000000000000bb",
    });

    expect(verifyResult).toMatchObject({ ok: false, error: { kind: "replay_detected", payment: null } });
  });

  test("a refusal about the payment's terms names no payment", async () => {
    const verifyResult = await refuseVerify({
      networkName: "arc",
      invalidReason: "invalid_exact_evm_authorization_value",
      payer: SIGNED_PAYER,
    });

    expect(verifyResult).toEqual({ ok: false, error: { kind: "amount_mismatch", expected: 0.01, received: 0.01 } });
  });
});
