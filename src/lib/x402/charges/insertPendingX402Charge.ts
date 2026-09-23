import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { NetworkConfig } from "@/lib/x402/networks";

/**
 * Insert an x402_charges row with status="pending" BEFORE on-chain
 * settlement.
 *
 * Ordering rationale: the row (with its UNIQUE nonce) must exist before
 * settle is called so that (a) a crash between settle and any later write
 * leaves a pending charge the reconciliation sweep can find instead of
 * settled money with no record, and (b) a concurrent replay of the same
 * payment loses the nonce-unique insert race here, before any second
 * settle attempt.
 *
 * Settlement fields (tx_hash, settled_at) are written by markChargeSettled
 * in chargeTransitions.ts after the facilitator confirms.
 *
 * Called by: charges/chargeLifecycle.settleCharge, solanaActions/postNowBlink.ts
 * Tables touched: x402_charges (insert)
 *
 * Returns errors as values. Never throws.
 */
export async function insertPendingX402Charge(params: {
  principalId: string;
  walletId: string;
  action: string;
  amountUsdc: number;
  amountUsdAtReceipt: number | null;
  network: NetworkConfig;
  nonce: string;
  requestId: string;
  payerAddress: string;
  recipientAddress: string;
  /**
   * Who settled the payment. Defaults to the network's settlement lane
   * (networks.ts); the Blink path passes its own label because the wallet
   * broadcast the payment itself and no facilitator was involved.
   */
  facilitator?: string;
}): Promise<
  | { success: true; chargeId: string }
  | { success: false; message: string; conflictReason?: "nonce_used" | "request_id_used" }
> {
  const { data: insertedRow, error } = await adminSupabase
    .from("x402_charges")
    .insert({
      principal_id: params.principalId,
      wallet_id: params.walletId,
      action: params.action,
      amount_usdc: params.amountUsdc,
      amount_usd_at_receipt: params.amountUsdAtReceipt,
      network: params.network.name,
      asset: "USDC",
      nonce: params.nonce,
      request_id: params.requestId,
      payer_address: params.payerAddress,
      recipient_address: params.recipientAddress,
      status: "pending",
      facilitator: params.facilitator ?? params.network.settlement,
    })
    .select("id")
    .single();

  if (error) {
    // Unique violations are identified by Postgres code, then by the
    // constraint named in the details (x402_charges_nonce_key,
    // x402_charges_request_id_key).
    if (error.code === "23505") {
      const detail = error.details ?? "";
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
    console.error(`[insertPendingX402Charge] Insert failed: ${error.message}`);
    return { success: false, message: error.message || "Charge insert failed." };
  }

  return { success: true, chargeId: insertedRow.id };
}
