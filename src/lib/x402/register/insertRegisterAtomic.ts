import "server-only";

import type { WalletChain } from "@/lib/types/database.types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsertRegisterAtomicInput {
  principalId: string;
  address: string;
  chain: WalletChain;
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
  sanctionsSource: string;
}

export type InsertRegisterAtomicResult =
  | {
      ok: true;
      principalId: string;
      walletId: string;
      chargeId: string;
    }
  | {
      ok: false;
      error:
        | {
            kind: "unique_violation";
            column: "address" | "nonce" | "request_id" | "unknown";
            message: string;
          }
        | { kind: "principal_kind_mismatch"; message: string }
        | { kind: "rpc_error"; message: string };
    };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Calls register_wallet_atomic RPC via PostgREST. The function INSERTs 5
 * rows atomically: principals, wallets, sanctions_screenings, x402_charges,
 * wallet_credits.
 *
 * Uses a direct fetch to PostgREST because the generated database.types.ts
 * does not yet include register_wallet_atomic (Drew runs the SQL migration
 * post-build). This avoids modifying database.types.ts.
 *
 * Never throws; all errors returned as typed variants.
 */
export async function insertRegisterAtomic(
  input: InsertRegisterAtomicInput
): Promise<InsertRegisterAtomicResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[insertRegisterAtomic] Missing Supabase env vars.");
    return {
      ok: false,
      error: { kind: "rpc_error", message: "Database not configured." },
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/register_wallet_atomic`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          p_principal_id: input.principalId,
          p_address: input.address,
          p_chain: input.chain,
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
          p_sanctions_source: input.sanctionsSource,
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return parsePostgrestError(text);
    }

    const result = (await response.json()) as {
      principal_id: string;
      wallet_id: string;
      charge_id: string;
    };

    if (
      !result ||
      typeof result.principal_id !== "string" ||
      typeof result.charge_id !== "string"
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
      principalId: result.principal_id,
      walletId: result.wallet_id,
      chargeId: result.charge_id,
    };
  } catch (err) {
    console.error("[insertRegisterAtomic] Unexpected error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "rpc_error",
        message: err instanceof Error
          ? err.message
          : "Unexpected error calling register_wallet_atomic.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

function parsePostgrestError(text: string): InsertRegisterAtomicResult {
  let body: { code?: string; details?: string; message?: string };
  try {
    body = JSON.parse(text);
  } catch {
    body = { message: text };
  }

  const code = body.code;
  const details = body.details ?? "";
  const message = body.message ?? "RPC failed.";

  // 23505 = unique_violation
  if (code === "23505") {
    if (details.includes("address")) {
      return {
        ok: false,
        error: { kind: "unique_violation", column: "address", message },
      };
    }
    if (details.includes("nonce")) {
      return {
        ok: false,
        error: { kind: "unique_violation", column: "nonce", message },
      };
    }
    if (details.includes("request_id")) {
      return {
        ok: false,
        error: { kind: "unique_violation", column: "request_id", message },
      };
    }
    return {
      ok: false,
      error: { kind: "unique_violation", column: "unknown", message },
    };
  }

  // Trigger error from enforce_principal_kind
  if (
    message.includes("enforce_principal_kind") ||
    message.includes("principal_kind")
  ) {
    return {
      ok: false,
      error: { kind: "principal_kind_mismatch", message },
    };
  }

  console.error(`[insertRegisterAtomic] RPC failed (code=${code}): ${message}`);
  return { ok: false, error: { kind: "rpc_error", message } };
}
