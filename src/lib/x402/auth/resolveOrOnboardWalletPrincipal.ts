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
 * Sanctions source recorded for wallets cleared by the CDP facilitator's
 * KYT check during payment verification (base/polygon/arbitrum/solana).
 * sourceRef: the deleted register flow (src/lib/x402/register/, June 2026)
 */
const SANCTIONS_SOURCE_CDP_KYT = "cdp_kyt";

/**
 * Source recorded when the clearing verify ran at the Celo facilitator
 * instead of CDP. Named after the facilitator so the screening trail stays
 * honest per network: whether x402.celo.org runs KYT is that facilitator's
 * behavior, and the row must not claim a CDP screen that never happened.
 */
const SANCTIONS_SOURCE_CELO_FACILITATOR = "celo_facilitator";

/**
 * Source recorded when nobody screened the payer: on the arc_local lane
 * Sharetopus verifies and settles the payment itself (arc/arcFacilitator.ts)
 * and no third party runs KYT along the way. The row says so instead of
 * borrowing CDP's name, and the wallet is left at sanctions_status
 * "unchecked".
 */
const SANCTIONS_SOURCE_UNSCREENED = "unscreened";

/** Screening source for the lane that verified this payment. */
function sanctionsSourceForNetwork(network: NetworkConfig): string {
  switch (network.settlement) {
    case "coinbase_cdp":
      return SANCTIONS_SOURCE_CDP_KYT;
    case "celo":
      return SANCTIONS_SOURCE_CELO_FACILITATOR;
    case "arc_local":
      return SANCTIONS_SOURCE_UNSCREENED;
  }
}

/**
 * Whether a third-party facilitator screened the payer during verify. Keyed
 * on the settlement lane, so the next self-settled lane inherits the honest
 * default instead of a borrowed claim.
 */
function hasFacilitatorScreening(network: NetworkConfig): boolean {
  return network.settlement !== "arc_local";
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Resolves the paying wallet to its principal, onboarding it on first contact.
 *
 * MUST be called with the facilitator-recovered payer address (the address
 * money actually moves from), never the unverified claim inside the payment
 * header, and only AFTER verifyPayment succeeded: the facilitator screens
 * the payer as part of verify (KYT on the CDP facilitator), so a payer that
 * reaches this function passed that facilitator's verify on this very call.
 * The recorded sanctions source names which facilitator cleared it, so the
 * screening trail stays honest per network.
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
  const normalizedAddress = normalizeWalletAddress(params.payerAddress);

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
    p_sanctions_source: sanctionsSourceForNetwork(params.network),
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
    // onboard_wallet_atomic marks a fresh wallet clean, which is only true
    // where a facilitator screened it during verify. On a self-settled
    // network it did not, so the row is corrected to "unchecked" rather
    // than left claiming a check nobody ran. A failed correction is logged
    // and the call still proceeds: the gate below only ever blocks
    // "sanctioned", so an over-optimistic label changes no access decision,
    // and failing the payment here would punish the agent for our bookkeeping.
    const screened = hasFacilitatorScreening(params.network);
    if (!screened) {
      const { error: unscreenedError } = await adminSupabase
        .from("wallets")
        .update({ sanctions_status: "unchecked" })
        .eq("id", row.wallet_id);
      if (unscreenedError) {
        console.error(
          `[resolveOrOnboardWalletPrincipal] Could not mark wallet ${row.wallet_id} unchecked on ${params.network.name}: ${unscreenedError.message}`
        );
      }
    }
    return {
      ok: true,
      isNewWallet: true,
      principal: {
        kind: "wallet",
        principalId: row.principal_id,
        walletId: row.wallet_id,
        address: normalizedAddress,
        chain: params.network.name,
        sanctionsStatus: screened ? "clean" : "unchecked",
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

export type ResolveExistingWalletPrincipalResult =
  | { ok: true; principal: WalletPrincipal }
  | { ok: false; reason: "unknown_wallet" }
  | {
      ok: false;
      reason: "sanctioned";
      message: string;
      principal: WalletPrincipal;
    }
  | { ok: false; reason: "db_error"; message: string };

/**
 * Lookup-only variant for flows where no facilitator screened the payer
 * (the post-now Blink: the wallet broadcasts its own payment). It never
 * onboards, so no sanctions_screenings row is written claiming a KYT check
 * that did not happen. A wallet must have paid through x402 at least once
 * (connect) before it can use those flows; the sanctions disposition from
 * that screening still applies here.
 *
 * Called by: solanaActions/postNowBlink.ts
 * Tables touched: wallets (read)
 */
export async function resolveExistingWalletPrincipal(
  payerAddress: string
): Promise<ResolveExistingWalletPrincipalResult> {
  const lookup = await lookupWalletByAddress(normalizeWalletAddress(payerAddress));
  if (!lookup.ok) {
    return { ok: false, reason: "db_error", message: "Failed to look up wallet." };
  }
  if (!lookup.wallet) {
    return { ok: false, reason: "unknown_wallet" };
  }
  const disposition = buildDisposition(lookup.wallet, false);
  if (disposition.ok) {
    return { ok: true, principal: disposition.principal };
  }
  return disposition;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** EVM addresses compare lowercased; Solana base58 is case-significant and kept verbatim. */
function normalizeWalletAddress(walletAddress: string): string {
  return walletAddress.startsWith("0x") ? walletAddress.toLowerCase() : walletAddress;
}

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
