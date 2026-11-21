import { afterAll, describe, expect, mock, test } from "bun:test";
import {
  AccountRole,
  address,
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";

mock.module("server-only", () => ({}));

const SENDER_ADDRESS = "SysvarRent111111111111111111111111111111111";
const PAYER_WALLET_ADDRESS = "So11111111111111111111111111111111111111112";
const FAKE_BLOCKHASH = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

process.env.X402_RECIPIENT_SOLANA = SENDER_ADDRESS;
process.env.X402_SOLANA_RPC_URL = "https://solana-rpc.invalid";

const sentTransactions: string[] = [];
const rpcMethodsCalled: string[] = [];
const realFetch = globalThis.fetch;

globalThis.fetch = Object.assign(
  async (_url: string | URL | Request, init?: RequestInit) => {
    const payload: unknown = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const method = typeof payload === "object" && payload !== null && "method" in payload ? payload.method : null;
    const requestId = typeof payload === "object" && payload !== null && "id" in payload ? payload.id : null;
    rpcMethodsCalled.push(String(method));
    if (method !== "getLatestBlockhash") {
      return new Response("unexpected RPC method", { status: 500 });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: requestId,
      result: { context: { slot: 1 }, value: { blockhash: FAKE_BLOCKHASH, lastValidBlockHeight: 100 } },
    });
  },
  { preconnect: realFetch.preconnect },
);

afterAll(() => {
  globalThis.fetch = realFetch;
});

mock.module("@/lib/x402/cdp/cdpClient", () => ({
  getCdpClient: () => ({
    ok: true,
    client: {
      solana: {
        sendTransaction: async (request: { transaction: string }) => {
          sentTransactions.push(request.transaction);
          return { signature: "fake-refund-signature" };
        },
      },
    },
  }),
  sendThroughCdp: async (params: { send: () => Promise<string> }) => ({
    status: "sent",
    txHash: await params.send(),
  }),
}));

const { NETWORKS } = await import("@/lib/x402/networks");
const { refundSolana } = await import("./refundSolana");
const { findAssociatedTokenAddress } = await import("./splToken");

function decodeInstructions(base64Transaction: string) {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64Transaction));
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  return decompileTransactionMessage(compiledMessage).instructions;
}

describe("refundSolana", () => {
  test("recreates the payer's USDC account before the transfer, paid by the refund sender", async () => {
    const refundResult = await refundSolana({
      payerAddress: PAYER_WALLET_ADDRESS,
      amountUsdc: 0.25,
      network: NETWORKS.solana,
      reason: "test refund",
      idempotencyKey: "refund-key",
    });

    expect(refundResult).toEqual({ status: "sent", txHash: "fake-refund-signature" });
    expect(rpcMethodsCalled).toEqual(["getLatestBlockhash"]);
    expect(sentTransactions).toHaveLength(1);

    const usdcMint = address(NETWORKS.solana.usdcAddress);
    const payerTokenAccount = await findAssociatedTokenAddress(address(PAYER_WALLET_ADDRESS), usdcMint);
    const senderTokenAccount = await findAssociatedTokenAddress(address(SENDER_ADDRESS), usdcMint);
    const [createAccountInstruction, transferInstruction] = decodeInstructions(sentTransactions[0] ?? "");

    expect(createAccountInstruction?.programAddress).toBe(
      address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
    );
    expect(Array.from(createAccountInstruction?.data ?? [])).toEqual([1]);
    expect(createAccountInstruction?.accounts?.slice(0, 4)).toEqual([
      { address: address(SENDER_ADDRESS), role: AccountRole.WRITABLE_SIGNER },
      { address: payerTokenAccount, role: AccountRole.WRITABLE },
      { address: address(PAYER_WALLET_ADDRESS), role: AccountRole.READONLY },
      { address: usdcMint, role: AccountRole.READONLY },
    ]);

    expect(transferInstruction?.programAddress).toBe(address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"));
    expect(Array.from(transferInstruction?.data ?? [])).toEqual([12, 144, 208, 3, 0, 0, 0, 0, 0, 6]);
    expect(transferInstruction?.accounts).toEqual([
      { address: senderTokenAccount, role: AccountRole.WRITABLE },
      { address: usdcMint, role: AccountRole.READONLY },
      { address: payerTokenAccount, role: AccountRole.WRITABLE },
      { address: address(SENDER_ADDRESS), role: AccountRole.WRITABLE_SIGNER },
    ]);
  });
});
