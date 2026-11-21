import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

mock.module("server-only", () => ({}));

const FAKE_CELO_FACILITATOR_URL = "https://celo-facilitator.test";
process.env.X402_CELO_FACILITATOR_URL = FAKE_CELO_FACILITATOR_URL;
process.env.X402_CELO_FACILITATOR_API_KEY = "test-settle-key";

const { getFacilitatorClient } = await import("./facilitatorClient");
const { getNetworkConfig } = await import("./networks");

type FakeReply = { status: number; body: string };

const originalFetch = globalThis.fetch;
let replyByPath = new Map<string, FakeReply>();

function answerFromReplies(input: RequestInfo | URL): Promise<Response> {
  const requestUrl = new URL(input instanceof Request ? input.url : input.toString());
  const reply = replyByPath.get(requestUrl.pathname);
  if (!reply) return Promise.reject(new Error(`No fake reply for ${requestUrl.pathname}`));
  return Promise.resolve(new Response(reply.body, { status: reply.status }));
}

globalThis.fetch = Object.assign(answerFromReplies, { preconnect: originalFetch.preconnect });

afterAll(() => {
  globalThis.fetch = originalFetch;
});

beforeEach(() => {
  replyByPath = new Map();
});

const celoNetwork = getNetworkConfig("celo");
if (!celoNetwork) throw new Error("[facilitatorClient.test] celo is missing from the network registry");

const celoClientResult = getFacilitatorClient(celoNetwork);
if (!celoClientResult.ok) throw new Error(`[facilitatorClient.test] ${celoClientResult.message}`);
const celoClient = celoClientResult.client;

const REQUIREMENTS: PaymentRequirements = {
  scheme: "exact",
  network: celoNetwork.caipNetwork,
  asset: celoNetwork.usdcAddress,
  amount: "10000",
  payTo: "0x0000000000000000000000000000000000000001",
  maxTimeoutSeconds: 60,
  extra: {},
};

const PAYLOAD: PaymentPayload = {
  x402Version: 2,
  accepted: REQUIREMENTS,
  payload: {},
};

describe("hosted facilitator client", () => {
  test("a settle refused with a 4xx and a SettleResponse body comes back as a failed settlement with its reason", async () => {
    replyByPath.set("/settle", {
      status: 400,
      body: JSON.stringify({
        success: false,
        errorReason: "invalid_exact_evm_insufficient_balance",
        errorMessage: "balance too low",
        transaction: "",
        network: celoNetwork.caipNetwork,
      }),
    });

    const settleResponse = await celoClient.settle(PAYLOAD, REQUIREMENTS);

    expect(settleResponse.success).toBe(false);
    expect(settleResponse.errorReason).toBe("invalid_exact_evm_insufficient_balance");
    expect(settleResponse.network).toBe(celoNetwork.caipNetwork);
  });

  test("a verify refused with a 4xx and a VerifyResponse body comes back as an invalid payment with its reason", async () => {
    replyByPath.set("/verify", {
      status: 400,
      body: JSON.stringify({ isValid: false, invalidReason: "invalid_exact_evm_signature" }),
    });

    const verifyResponse = await celoClient.verify(PAYLOAD, REQUIREMENTS);

    expect(verifyResponse.isValid).toBe(false);
    expect(verifyResponse.invalidReason).toBe("invalid_exact_evm_signature");
  });

  test("a settle answered by an outage page still throws, so the settlement stays indeterminate", async () => {
    replyByPath.set("/settle", { status: 502, body: "<html>Bad Gateway</html>" });

    const settleAttempt = celoClient.settle(PAYLOAD, REQUIREMENTS);

    await expect(settleAttempt).rejects.toThrow("Facilitator settle failed (502)");
  });
});
