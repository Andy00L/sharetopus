import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  HttpRequestError,
  RpcRequestError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  keccak256,
  numberToHex,
  type Address,
  type Hex,
} from "viem";

import type { OperatorSigner } from "./broadcastCall";
import type { RefundSendInput } from "./refundSender";

mock.module("server-only", () => ({}));

const { broadcastCall } = await import("./broadcastCall");
const { sendOperatorRefund } = await import("./refundSender");
const { getNetworkConfig } = await import("@/lib/x402/networks");

const RPC_URL_WITH_KEY = "https://rpc.invalid/v2/secret-api-key";
const OPERATOR_ADDRESS: Address = "0x00000000000000000000000000000000000000a1";
const USDC_CONTRACT: Address = "0x00000000000000000000000000000000000000c1";
const TRANSFER_CALLDATA: Hex = "0xa9059cbb";

const FAKE_CHAIN = defineChain({
  id: 31337,
  name: "Fake chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL_WITH_KEY] } },
});

type SendReply = "accept" | "transport_failure" | "nonce_too_low" | "insufficient_funds";
type LookupReply = "not_found" | "transport_failure";

let sendReplies: SendReply[] = [];
let lookupReplies: LookupReply[] = [];
let sentRawTransactions: string[] = [];
let signedTransactions: Hex[] = [];

function buildTransportFailure(method: string): HttpRequestError {
  return new HttpRequestError({ url: RPC_URL_WITH_KEY, status: 502, details: "Bad Gateway", body: { method } });
}

function buildNodeRejection(message: string): RpcRequestError {
  return new RpcRequestError({ body: { method: "eth_sendRawTransaction" }, error: { code: -32000, message }, url: RPC_URL_WITH_KEY });
}

function readFirstParam(params: unknown): unknown {
  return Array.isArray(params) ? params[0] : undefined;
}

async function answerRpc({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
  switch (method) {
    case "eth_chainId":
      return numberToHex(FAKE_CHAIN.id);
    case "eth_getTransactionCount":
      return "0x0";
    case "eth_getBlockByNumber":
      return { number: "0x1", baseFeePerGas: "0x1", timestamp: "0x0", transactions: [] };
    case "eth_maxPriorityFeePerGas":
      return "0x1";
    case "eth_estimateGas":
      return "0x5208";
    case "eth_signTransaction": {
      const signedTransaction: Hex = `0x02f8${(signedTransactions.length + 1).toString(16).padStart(4, "0")}`;
      signedTransactions.push(signedTransaction);
      return signedTransaction;
    }
    case "eth_sendRawTransaction": {
      const rawTransaction = readFirstParam(params);
      sentRawTransactions.push(typeof rawTransaction === "string" ? rawTransaction : "");
      const sendReply = sendReplies.shift() ?? "accept";
      if (sendReply === "transport_failure") throw buildTransportFailure(method);
      if (sendReply === "nonce_too_low") throw buildNodeRejection("nonce too low");
      if (sendReply === "insufficient_funds") throw buildNodeRejection("insufficient funds for gas * price + value");
      return rawTransaction;
    }
    case "eth_getTransactionByHash": {
      const lookupReply = lookupReplies.shift() ?? "not_found";
      if (lookupReply === "transport_failure") throw buildTransportFailure(method);
      return null;
    }
    default:
      throw new Error(`[answerRpc] The fake RPC has no answer for ${method}.`);
  }
}

const fakeTransport = custom({ request: answerRpc }, { retryCount: 0 });

const fakeSigner: OperatorSigner = {
  account: { address: OPERATOR_ADDRESS, type: "json-rpc" },
  chain: FAKE_CHAIN,
  publicClient: createPublicClient({ chain: FAKE_CHAIN, transport: fakeTransport }),
  walletClient: createWalletClient({ chain: FAKE_CHAIN, transport: fakeTransport }),
  noRetryClient: createPublicClient({ chain: FAKE_CHAIN, transport: fakeTransport }),
};

function broadcastTransfer() {
  return broadcastCall(fakeSigner, { to: USDC_CONTRACT, data: TRANSFER_CALLDATA }, "refund");
}

function requireCeloNetwork() {
  const network = getNetworkConfig("celo");
  if (!network) throw new Error("[requireCeloNetwork] celo is missing from the network registry");
  return network;
}

function sendRefund() {
  const input: RefundSendInput = {
    payerAddress: "0x00000000000000000000000000000000000000aa",
    amountUsdc: 0.01,
    network: requireCeloNetwork(),
    reason: "Could not dispatch the post.",
    idempotencyKey: "6f1f6a43-2b3c-4d5e-8f90-0a1b2c3d4e5f",
  };
  return sendOperatorRefund({ signer: fakeSigner, call: { to: USDC_CONTRACT, data: TRANSFER_CALLDATA }, input });
}

beforeEach(() => {
  sendReplies = [];
  lookupReplies = [];
  sentRawTransactions = [];
  signedTransactions = [];
});

describe("broadcastCall", () => {
  test("three transport failures return the signed hash as delivery unknown, after resending the same bytes", async () => {
    sendReplies = ["transport_failure", "transport_failure", "transport_failure"];

    const broadcast = await broadcastTransfer();

    expect(signedTransactions).toHaveLength(1);
    const signedTransaction = signedTransactions[0] ?? "0x";
    expect(sentRawTransactions).toEqual([signedTransaction, signedTransaction, signedTransaction]);
    expect(broadcast).toMatchObject({ status: "delivery_unknown", transactionHash: keccak256(signedTransaction) });
    expect(JSON.stringify(broadcast)).not.toContain("secret-api-key");
  });

  test("a lost send followed by a taken nonce is not signed again when the chain cannot be asked about the first bytes", async () => {
    sendReplies = ["transport_failure", "nonce_too_low"];
    lookupReplies = ["not_found", "transport_failure"];

    const broadcast = await broadcastTransfer();

    expect(signedTransactions).toHaveLength(1);
    expect(broadcast).toMatchObject({
      status: "delivery_unknown",
      transactionHash: keccak256(signedTransactions[0] ?? "0x"),
    });
  });

  test("a nonce another transaction took, with our bytes unknown to the chain, is signed again and the new hash returned", async () => {
    sendReplies = ["nonce_too_low", "accept"];

    const broadcast = await broadcastTransfer();

    expect(signedTransactions).toHaveLength(2);
    expect(broadcast).toEqual({ status: "accepted", transactionHash: keccak256(signedTransactions[1] ?? "0x") });
  });
});

describe("sendOperatorRefund", () => {
  test("a refund whose sends all failed in transport is an unknown outcome that keeps the signed hash", async () => {
    sendReplies = ["transport_failure", "transport_failure", "transport_failure"];

    const refundSend = await sendRefund();

    expect(refundSend).toMatchObject({
      status: "outcome_unknown",
      txHash: keccak256(signedTransactions[0] ?? "0x"),
    });
  });

  test("a refund the node refuses is not sent and carries no hash", async () => {
    sendReplies = ["insufficient_funds"];

    const refundSend = await sendRefund();

    expect(sentRawTransactions).toHaveLength(1);
    expect(refundSend).toMatchObject({ status: "not_sent" });
    expect(refundSend).not.toHaveProperty("txHash");
  });
});
