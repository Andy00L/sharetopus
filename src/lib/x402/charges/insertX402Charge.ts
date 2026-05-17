import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Insert a settled x402_charges row in one step (post-settlement).
 *
 * Mirrors the register/connect pattern: charge is inserted AFTER on-chain
 * settle succeeds, with status="settled" and all settlement metadata
 * populated in a single INSERT. No pending state, no follow-up update.
 *
 * Steps:
 * 1. Build insert payload with status="settled" and settlement fields.
 * 2. INSERT into x402_charges.
 * 3. Return generated charge ID on success.
 * 4. Map unique constraint violations on nonce/request_id to typed reasons.
 *
 * Returns errors as values. Never throws.
 */
export async function insertX402Charge(params: {
  principalId: string;
  walletId: string;
  action: string;
  amountUsdc: number;
  amountUsdAtReceipt: number | null;
  network: string;
  nonce: string;
  requestId: string;
  payerAddress: string;
  recipientAddress: string;
  txHash: string;
  blockNumber: number | null;
  facilitatorFeeUsdc: number | null;
}): Promise<
  | { success: true; chargeId: string }
  | { success: false; message: string; conflictReason?: "nonce_used" | "request_id_used" }
> {
  const { data, error } = await adminSupabase
    .from("x402_charges")
    .insert({
      principal_id: params.principalId,
      wallet_id: params.walletId,
      action: params.action,
      amount_usdc: params.amountUsdc,
      amount_usd_at_receipt: params.amountUsdAtReceipt,
      network: params.network,
      asset: "USDC",
      nonce: params.nonce,
      request_id: params.requestId,
      payer_address: params.payerAddress,
      recipient_address: params.recipientAddress,
      status: "settled",
      facilitator: "coinbase_cdp",
      facilitator_fee_usdc: params.facilitatorFeeUsdc,
      tx_hash: params.txHash,
      block_number: params.blockNumber,
      settled_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // Detect unique constraint violations by Postgres error code.
    const pgCode = (error as { code?: string }).code;
    if (pgCode === "23505") {
      const detail = (error as { details?: string }).details ?? "";
      if (detail.includes("nonce")) {
        return {
          success: false,
          message: "Payment nonce already used. Possible replay.",
          conflictReason: "nonce_used",
        };
      }
      if (detail.includes("request_id")) {
        return {
          success: false,
          message: "Duplicate request ID. Already processed.",
          conflictReason: "request_id_used",
        };
      }
    }
    console.error("[insertX402Charge] Insert failed:", error);
    return { success: false, message: error.message ?? "Charge insert failed." };
  }

  return { success: true, chargeId: data.id };
}
