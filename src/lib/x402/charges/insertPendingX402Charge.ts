import "server-only";

import { db, isUniqueViolation, runQuery } from "@/db/client";
import { x402_charges } from "@/db/schema";
import type { NetworkConfig } from "@/lib/x402/networks";

const NONCE_UNIQUE_CONSTRAINT = "x402_charges_nonce_key";
const REQUEST_ID_UNIQUE_CONSTRAINT = "x402_charges_request_id_key";

export async function insertPendingX402Charge(params: {
  principalId: string;
  action: string;
  amountUsdc: number;
  amountUsdAtReceipt: number | null;
  network: NetworkConfig;
  nonce: string;
  requestId: string;
  payerAddress: string;
  recipientAddress: string;
  facilitator?: string;
}): Promise<
  | { success: true; chargeId: string }
  | { success: false; message: string; conflictReason?: "nonce_used" | "request_id_used" }
> {
  const { data: insertedRows, error } = await runQuery(
    db
      .insert(x402_charges)
      .values({
        principal_id: params.principalId,
        wallet_id: params.principalId,
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
      .returning({ id: x402_charges.id }),
  );

  if (error) {
    if (isUniqueViolation(error)) {
      if (error.message.includes(NONCE_UNIQUE_CONSTRAINT)) {
        return {
          success: false,
          message: "Payment nonce already used. Possible replay.",
          conflictReason: "nonce_used",
        };
      }
      if (error.message.includes(REQUEST_ID_UNIQUE_CONSTRAINT)) {
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

  const insertedRow = insertedRows[0];
  if (!insertedRow) {
    console.error("[insertPendingX402Charge] Insert returned no row.");
    return { success: false, message: "Charge insert failed." };
  }
  return { success: true, chargeId: insertedRow.id };
}
