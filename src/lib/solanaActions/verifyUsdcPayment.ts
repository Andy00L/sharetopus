import "server-only";

import { createSolanaRpc, signature as toSignature } from "@solana/kit";
import type { Signature } from "@solana/kit";

import { getSolanaRpcUrl } from "@/lib/x402/config";
import type { NetworkConfig } from "@/lib/x402/networks";

/**
 * Verifies, from the chain itself, that a wallet-broadcast transaction paid
 * at least the expected USDC to the recipient. No facilitator is involved on
 * the Blink path, so this is the payment verification: the transaction must
 * be confirmed and successful, its fee payer (first signer) must be the
 * wallet that claims to have paid, and the recipient's USDC balance must
 * rise by at least the price. Balance deltas come from the RPC's pre and
 * post token balances, which hold for any wallet-injected instructions
 * (Lighthouse guards, compute budget) around the transfer.
 *
 * Replay protection is not here: the caller records the signature as the
 * charge nonce, and x402_charges.nonce is UNIQUE.
 *
 * Called by: solanaActions/postNowBlink.ts (confirm step)
 * Tables touched: none. Network: getTransaction on the pinned RPC.
 */

/** Poll budget after a wallet reports its signature: 10 x 1.5s covers confirmation. */
const CONFIRMATION_POLL_ATTEMPTS = 10;
const CONFIRMATION_POLL_INTERVAL_MS = 1500;

export type VerifyUsdcPaymentResult =
  | {
      ok: true;
      txSignature: string;
      payerAddress: string;
      atomicReceived: bigint;
      slot: bigint;
      blockTimeUnixSeconds: bigint | null;
    }
  | {
      ok: false;
      reason:
        | "invalid_signature"
        | "not_found"
        | "failed_on_chain"
        | "payer_mismatch"
        | "no_usdc_credit"
        | "amount_short"
        | "rpc_error";
      message: string;
    };

export async function verifyUsdcPayment(params: {
  txSignatureRaw: string;
  expectedPayerAddress: string;
  recipientAddress: string;
  usdcMint: string;
  minimumAtomicAmount: bigint;
  network: NetworkConfig;
}): Promise<VerifyUsdcPaymentResult> {
  let txSignature: Signature;
  try {
    txSignature = toSignature(params.txSignatureRaw);
  } catch {
    return {
      ok: false,
      reason: "invalid_signature",
      message: "signature is not a valid Solana transaction signature.",
    };
  }

  const rpc = createSolanaRpc(getSolanaRpcUrl(params.network));
  let transaction: Awaited<ReturnType<typeof fetchConfirmedTransaction>> = null;
  for (let attempt = 0; attempt < CONFIRMATION_POLL_ATTEMPTS; attempt += 1) {
    try {
      transaction = await fetchConfirmedTransaction(rpc, txSignature);
    } catch (err) {
      const message = err instanceof Error ? err.message : "RPC read failed.";
      console.error(`[verifyUsdcPayment] getTransaction failed: ${message}`);
      return { ok: false, reason: "rpc_error", message: "Could not read the transaction from the network." };
    }
    if (transaction) break;
    await new Promise((resolve) => setTimeout(resolve, CONFIRMATION_POLL_INTERVAL_MS));
  }
  if (!transaction) {
    return {
      ok: false,
      reason: "not_found",
      message: "Transaction not confirmed yet. Wait a few seconds and try again.",
    };
  }

  if (transaction.meta?.err) {
    return {
      ok: false,
      reason: "failed_on_chain",
      message: "The payment transaction failed on-chain. Nothing was charged.",
    };
  }

  // The fee payer is static account 0 and must sign; the Blink's payment is
  // built with the wallet in that slot, so anything else is not that wallet's
  // payment.
  const feePayer = transaction.transaction.message.accountKeys[0];
  if (
    !feePayer ||
    !feePayer.signer ||
    String(feePayer.pubkey) !== params.expectedPayerAddress
  ) {
    return {
      ok: false,
      reason: "payer_mismatch",
      message: "The transaction was not paid by the wallet that started this action.",
    };
  }

  const postBalance = (transaction.meta?.postTokenBalances ?? []).find(
    (balance) =>
      String(balance.mint) === params.usdcMint &&
      balance.owner !== undefined &&
      String(balance.owner) === params.recipientAddress,
  );
  if (!postBalance) {
    return {
      ok: false,
      reason: "no_usdc_credit",
      message: "The transaction did not credit USDC to Sharetopus.",
    };
  }
  const preBalance = (transaction.meta?.preTokenBalances ?? []).find(
    (balance) => balance.accountIndex === postBalance.accountIndex,
  );
  // A freshly created recipient account has no pre entry: it started at zero.
  const atomicBefore = BigInt(preBalance?.uiTokenAmount.amount ?? "0");
  const atomicAfter = BigInt(postBalance.uiTokenAmount.amount);
  const atomicReceived = atomicAfter - atomicBefore;
  if (atomicReceived < params.minimumAtomicAmount) {
    return {
      ok: false,
      reason: "amount_short",
      message: `The transaction paid ${atomicReceived} atomic USDC; ${params.minimumAtomicAmount} was required.`,
    };
  }

  return {
    ok: true,
    txSignature: String(txSignature),
    payerAddress: String(feePayer.pubkey),
    atomicReceived,
    slot: transaction.slot,
    blockTimeUnixSeconds: transaction.blockTime ?? null,
  };
}

async function fetchConfirmedTransaction(
  rpc: ReturnType<typeof createSolanaRpc>,
  txSignature: Signature,
) {
  return rpc
    .getTransaction(txSignature, {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    })
    .send();
}
