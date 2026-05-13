import "server-only";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InsertConnectAtomicInput {
  principalId: string;
  walletId: string;
  platform: "linkedin" | "tiktok" | "pinterest" | "instagram";
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
 * Calls connect_wallet_atomic Postgres RPC. Atomic INSERT of x402_charges +
 * social_connections.
 *
 * Uses direct PostgREST fetch (mirrors insertRegisterAtomic.ts pattern) since
 * the RPC is not in database.types.ts until Drew regenerates types.
 *
 * Never throws; all errors returned as typed variants.
 */
export async function insertConnectAtomic(
  input: InsertConnectAtomicInput
): Promise<InsertConnectAtomicResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("[insertConnectAtomic] Missing Supabase env vars.");
    return {
      ok: false,
      error: { kind: "rpc_error", message: "Database not configured." },
    };
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/connect_wallet_atomic`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
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
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return parsePostgrestError(text);
    }

    const result = (await response.json()) as {
      charge_id: string;
      connection_id: string;
    };

    if (
      !result ||
      typeof result.charge_id !== "string" ||
      typeof result.connection_id !== "string"
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
      chargeId: result.charge_id,
      connectionId: result.connection_id,
    };
  } catch (err) {
    console.error("[insertConnectAtomic] Unexpected error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: {
        kind: "rpc_error",
        message: err instanceof Error
          ? err.message
          : "Unexpected error calling connect_wallet_atomic.",
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------

function parsePostgrestError(text: string): InsertConnectAtomicResult {
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
