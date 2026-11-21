import "server-only";

import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";

import { getCdpClient, sendThroughCdp } from "@/lib/x402/cdp/cdpClient";
import type { RefundSendInput, RefundSendResult } from "@/lib/x402/chain/refundSender";
import { getRecipientAddress, getRpcUrl } from "@/lib/x402/config";
import { buildUsdcTransferInstructions } from "@/lib/x402/solana/splToken";
import { usdcToAtomic } from "@/lib/x402/usdcAmount";

/** The Solana HTTP transport sets no timeout of its own. */
const BLOCKHASH_REQUEST_TIMEOUT_MS = 5_000;

export async function refundSolana(input: RefundSendInput): Promise<RefundSendResult> {
  const senderAddress = getRecipientAddress(input.network);
  if (!senderAddress) {
    return {
      status: "not_sent",
      message: `${input.network.recipientEnvVar} env var not set. Cannot issue the Solana refund.`,
    };
  }

  const cdpResult = getCdpClient();
  if (!cdpResult.ok) return { status: "not_sent", message: cdpResult.message };
  const cdpClient = cdpResult.client;

  const builtTransaction = await buildRefundTransaction(input, senderAddress);
  if (!builtTransaction.ok) {
    console.error(`[refundSolana] Could not build the refund: ${builtTransaction.message}`);
    return { status: "not_sent", message: builtTransaction.message };
  }

  const sendResult = await sendThroughCdp({
    send: async () => {
      const sentTransaction = await cdpClient.solana.sendTransaction({
        network: "solana",
        transaction: builtTransaction.base64Transaction,
        idempotencyKey: input.idempotencyKey,
      });
      return sentTransaction.signature;
    },
    operationName: "CDP refund send on Solana",
  });
  if (sendResult.status === "sent") {
    console.log(
      `[refundSolana] Refund sent: ${sendResult.txHash}, amount: ${input.amountUsdc} USDC, reason: ${input.reason}`,
    );
  }
  return sendResult;
}

async function buildRefundTransaction(
  input: RefundSendInput,
  senderAddress: string,
): Promise<{ ok: true; base64Transaction: string } | { ok: false; message: string }> {
  try {
    const atomicAmount = usdcToAtomic(input.amountUsdc, input.network.usdcDecimals);
    if (!atomicAmount.ok) return { ok: false, message: atomicAmount.message };

    const senderAddr = address(senderAddress);
    const refundInstructions = await buildUsdcTransferInstructions({
      sender: senderAddr,
      recipient: address(input.payerAddress),
      mint: address(input.network.usdcAddress),
      atomicAmount: atomicAmount.atomicAmount,
      decimals: input.network.usdcDecimals,
    });

    const { value: latestBlockhash } = await createSolanaRpc(getRpcUrl(input.network))
      .getLatestBlockhash()
      .send({ abortSignal: AbortSignal.timeout(BLOCKHASH_REQUEST_TIMEOUT_MS) });

    const txMessage = appendTransactionMessageInstructions(
      refundInstructions,
      setTransactionMessageLifetimeUsingBlockhash(
        latestBlockhash,
        setTransactionMessageFeePayer(
          senderAddr,
          createTransactionMessage({ version: 0 }),
        ),
      ),
    );

    const compiledTx = compileTransaction(txMessage);
    return { ok: true, base64Transaction: getBase64EncodedWireTransaction(compiledTx) };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Unexpected error while building the Solana refund.",
    };
  }
}
