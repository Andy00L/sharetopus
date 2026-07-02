import "server-only";

import { randomBytes } from "node:crypto";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { SanctionsStatus, WalletChain } from "@/lib/types/database.types";
import type { NetworkConfig } from "@/lib/x402/networks";
import { callPostgrestRpc } from "@/lib/x402/rpc/callPostgrestRpc";
import type { WalletPrincipal } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolveOrOnboardWalletPrincipalResult =
  | { ok: true; principal: WalletPrincipal; isNewWallet: boolean }
  | {
      ok: false;
      reason: "sanctioned";
      message: string;
      /** Identity of the denied wallet, for audit-log attribution. */
      principal: WalletPrincipal;
    }
  | { ok: false; reason: "db_error"; message: string };

/**
 * Sanctions source recorded for wallets cleared by the facilitator's KYT
 * check during payment verification.
 * sourceRef: the deleted register flow (src/lib/x402/register/, June 2026)
 */
const SANCTIONS_SOURCE_CDP_KYT = "cdp_kyt";

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Resolves the paying wallet to its principal, onboarding it on first contact.
 *
 * MUST be called with the facilitator-recovered payer address (the address
 * money actually moves from), never the unverified claim inside the payment
 * header, and only AFTER verifyPayment succeeded: the facilitator runs KYT
 * (sanctions screening) as part of verify, so a payer that reaches this
 * function was screened on this very call. That screen is what makes
 * creating a fresh wallets row with sanctions_status "clean" sound.
 *
 * Sequence:
 *   1. Normalize the address (EVM lowercased, Solana base58 verbatim) and
 *      look it up by exact equality, never ILIKE: pattern matching on an
 *      attacker-supplied address would let % and _ act as SQL wildcards.
 *   2. A sanctioned wallet is rejected before any charge row exists.
 *   3. A missing wallet is onboarded through the onboard_wallet_atomic RPC,
 *      which owns all concurrency: adopt-by-address fast path, ON CONFLICT
 *      handling, and cleanup of its own orphaned principal on a lost race.
 *      Two concurrent first payments from one wallet both succeed; the RPC
 *      decides which call creates and which adopts (is_new in the result).
 *
 * Callers must order this between facilitator verify and the charge insert /
 * settle: screening and onboarding strictly precede any USDC movement.
 *
 * Called by: x402PaidEndpoint, handleConnectVerify
 * Tables touched: wallets (read); principals, wallets, sanctions_screenings,
 * wallet_credits (insert via the RPC; sanctions_screenings is append-only)
 */
export async function resolveOrOnboardWalletPrincipal(params: {
  payerAddress: string;
  network: NetworkConfig;
}): Promise<ResolveOrOnboardWalletPrincipalResult> {
  const normalizedAddress = params.payerAddress.startsWith("0x")
    ? params.payerAddress.toLowerCase()
    : params.payerAddress;

  const existingLookup = await lookupWalletByAddress(normalizedAddress);
  if (!existingLookup.ok) {
    return {
      ok: false,
      reason: "db_error",
      message: "Failed to look up wallet.",
    };
  }
  if (existingLookup.wallet) {
    return buildDisposition(existingLookup.wallet, false);
  }

  // First contact: onboard atomically. The RPC adopts by address when a
  // concurrent call created the row between the lookup above and this call.
  const principalId = `wallet_${randomBytes(16).toString("hex")}`;
  const rpcResult = await callPostgrestRpc("onboard_wallet_atomic", {
    p_principal_id: principalId,
    p_address: normalizedAddress,
    p_chain: params.network.name,
    p_sanctions_source: SANCTIONS_SOURCE_CDP_KYT,
  });

  if (!rpcResult.ok) {
    console.error(
      `[resolveOrOnboardWalletPrincipal] onboard_wallet_atomic failed (code=${rpcResult.error.code}): ${rpcResult.error.message}`
    );
    return {
      ok: false,
      reason: "db_error",
      message: "Failed to onboard wallet.",
    };
  }

  const row = rpcResult.row as {
    principal_id?: unknown;
    wallet_id?: unknown;
    is_new?: unknown;
  } | null;

  if (
    !row ||
    typeof row.principal_id !== "string" ||
    typeof row.wallet_id !== "string" ||
    typeof row.is_new !== "boolean"
  ) {
    console.error(
      "[resolveOrOnboardWalletPrincipal] onboard_wallet_atomic returned unexpected data shape."
    );
    return {
      ok: false,
      reason: "db_error",
      message: "Wallet onboarding returned unexpected data.",
    };
  }

  if (row.is_new) {
    console.log(
      `[resolveOrOnboardWalletPrincipal] Onboarded wallet ${row.wallet_id} (${normalizedAddress}) on ${params.network.name}`
    );
    return {
      ok: true,
      isNewWallet: true,
      principal: {
        kind: "wallet",
        principalId: row.principal_id,
        walletId: row.wallet_id,
        address: normalizedAddress,
        chain: params.network.name,
        sanctionsStatus: "clean",
      },
    };
  }

  // Adopted: a concurrent call created the row first. Re-read it so chain
  // and sanctions status reflect the DB, and so a sanctioned row is still
  // rejected on this path. Fail closed on a read error: nothing has settled.
  const adoptedLookup = await lookupWalletByAddress(normalizedAddress);
  if (!adoptedLookup.ok || !adoptedLookup.wallet) {
    return {
      ok: false,
      reason: "db_error",
      message: "Failed to read the adopted wallet after onboarding.",
    };
  }
  return buildDisposition(adoptedLookup.wallet, false);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface WalletRow {
  id: string;
  address: string;
  chain: WalletChain;
  sanctions_status: SanctionsStatus;
}

async function lookupWalletByAddress(
  normalizedAddress: string
): Promise<{ ok: true; wallet: WalletRow | null } | { ok: false }> {
  const { data: wallet, error } = await adminSupabase
    .from("wallets")
    .select("id, address, chain, sanctions_status")
    .eq("address", normalizedAddress)
    .maybeSingle();

  if (error) {
    console.error(
      `[resolveOrOnboardWalletPrincipal] DB error looking up wallet: ${error.message}`
    );
    return { ok: false };
  }
  return { ok: true, wallet };
}

/** Sanctioned wallets are rejected; clean and unchecked wallets pass. */
function buildDisposition(
  wallet: WalletRow,
  isNewWallet: boolean
): ResolveOrOnboardWalletPrincipalResult {
  const principal: WalletPrincipal = {
    kind: "wallet",
    principalId: wallet.id,
    walletId: wallet.id,
    address: wallet.address,
    chain: wallet.chain,
    sanctionsStatus: wallet.sanctions_status,
  };

  if (wallet.sanctions_status === "sanctioned") {
    console.warn(
      `[resolveOrOnboardWalletPrincipal] Sanctioned wallet denied: ${wallet.id}`
    );
    return {
      ok: false,
      reason: "sanctioned",
      // sourceRef: src/lib/x402/sanctions/applyWalletGate.ts (deleted June 2026)
      message:
        "This wallet has been flagged by sanctions screening and cannot transact.",
      principal,
    };
  }
  return { ok: true, isNewWallet, principal };
}
