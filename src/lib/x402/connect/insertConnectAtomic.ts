import "server-only";

import type { Platform } from "./types";
import { callPostgrestRpc } from "@/lib/x402/rpc/callPostgrestRpc";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsertConnectAtomicInput {
  principalId: string;
  walletId: string;
  platform: Platform;
  connectionId: string;
  oauthState: string;
  redirectUri: string;
  expiresAt: string;
  chargeNonce: string;
  chargeRequestId: string | null;
  chargeTxHash: string;
  chargeBlockNumber: number | null;
  chargeAmountUsdc: number;
  chargeFacilitatorFeeUsdc: number | null;
  chargeNetwork: string;
  chargeAsset: string;
  chargePayerAddress: string;
  chargeRecipientAddress: string;
  chargeFacilitator: string;
  chargeSettledAt: string;
}

export type InsertConnectAtomicResult =
  | { ok: true; chargeId: string; connectionId: string }
  | {
      ok: false;
      error:
        | { kind: "unique_violation"; column: string; message: string }
        | { kind: "rpc_error"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Calls the connect_wallet_atomic Postgres RPC: atomic INSERT of
 * x402_charges + social_connections. Goes through callPostgrestRpc because
 * the function is not in database.types.ts (hand-maintained; Drew updates it
 * separately).
 *
 * Called by: handleConnectVerify (post-settle)
 * Never throws; all errors returned as typed variants.
 */
export async function insertConnectAtomic(
  input: InsertConnectAtomicInput
): Promise<InsertConnectAtomicResult> {
  const rpcResult = await callPostgrestRpc("connect_wallet_atomic", {
    p_principal_id: input.principalId,
    p_wallet_id: input.walletId,
    p_platform: input.platform,
    p_connection_id: input.connectionId,
    p_oauth_state: input.oauthState,
    p_redirect_uri: input.redirectUri,
    p_expires_at: input.expiresAt,
    p_charge_nonce: input.chargeNonce,
    p_charge_request_id: input.chargeRequestId,
    p_charge_tx_hash: input.chargeTxHash,
    p_charge_block_number: input.chargeBlockNumber,
    p_charge_amount_usdc: input.chargeAmountUsdc,
    p_charge_facilitator_fee_usdc: input.chargeFacilitatorFeeUsdc,
    p_charge_network: input.chargeNetwork,
    p_charge_asset: input.chargeAsset,
    p_charge_payer_address: input.chargePayerAddress,
    p_charge_recipient_address: input.chargeRecipientAddress,
    p_charge_facilitator: input.chargeFacilitator,
    p_charge_settled_at: input.chargeSettledAt,
  });

  if (!rpcResult.ok) {
    const { code, details, message } = rpcResult.error;
    // 23505 = unique_violation
    if (code === "23505") {
      if (details.includes("oauth_state")) {
        return {
          ok: false,
          error: { kind: "unique_violation", column: "oauth_state", message },
        };
      }
      if (details.includes("nonce")) {
        return {
          ok: false,
          error: { kind: "unique_violation", column: "nonce", message },
        };
      }
      return {
        ok: false,
        error: { kind: "unique_violation", column: "unknown", message },
      };
    }
    console.error(`[insertConnectAtomic] RPC failed (code=${code}): ${message}`);
    return { ok: false, error: { kind: "rpc_error", message } };
  }

  const row = rpcResult.row as {
    charge_id?: unknown;
    connection_id?: unknown;
  } | null;

  if (
    !row ||
    typeof row.charge_id !== "string" ||
    typeof row.connection_id !== "string"
  ) {
    return {
      ok: false,
      error: {
        kind: "rpc_error",
        message: "RPC returned unexpected data shape.",
      },
    };
  }

  return {
    ok: true,
    chargeId: row.charge_id,
    connectionId: row.connection_id,
  };
}
