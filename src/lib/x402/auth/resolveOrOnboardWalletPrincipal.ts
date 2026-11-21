import "server-only";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { wallets } from "@/db/schema";
import type { SanctionsStatus, WalletChain } from "@/db/schema";
import type { NetworkConfig } from "@/lib/x402/networks";
import type { WalletPrincipal } from "./types";

export type ResolveOrOnboardWalletPrincipalResult =
  | { ok: true; principal: WalletPrincipal; isNewWallet: boolean }
  | {
      ok: false;
      reason: "sanctioned";
      message: string;
      principal: WalletPrincipal;
    }
  | { ok: false; reason: "db_error"; message: string };

const SANCTIONS_SOURCE_CDP_KYT = "cdp_kyt";

const SANCTIONS_SOURCE_CELO_FACILITATOR = "celo_facilitator";

const SANCTIONS_SOURCE_UNSCREENED = "unscreened";

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

function hasFacilitatorScreening(network: NetworkConfig): boolean {
  return network.settlement !== "arc_local";
}

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

  const principalId = `wallet_${randomBytes(16).toString("hex")}`;
  const sanctionsSource = sanctionsSourceForNetwork(params.network);
  const { data: onboardRows, error: onboardError } = await runQuery(
    db.execute(
      sql`select public.onboard_wallet_atomic(${principalId}, ${normalizedAddress}, ${params.network.name}, ${sanctionsSource}) as result`
    )
  );

  if (onboardError) {
    console.error(
      `[resolveOrOnboardWalletPrincipal] onboard_wallet_atomic failed (code=${onboardError.code}): ${onboardError.message}`
    );
    return {
      ok: false,
      reason: "db_error",
      message: "Failed to onboard wallet.",
    };
  }

  const row = parseOnboardWalletResult(onboardRows[0]?.result);
  if (!row) {
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
    const screened = hasFacilitatorScreening(params.network);
    if (!screened) {
      const { error: unscreenedError } = await runQuery(
        db
          .update(wallets)
          .set({ sanctions_status: "unchecked" })
          .where(eq(wallets.id, row.wallet_id))
      );
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
        address: normalizedAddress,
        chain: params.network.name,
        sanctionsStatus: screened ? "clean" : "unchecked",
      },
    };
  }

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
  const { data: walletRows, error } = await runQuery(
    db
      .select({
        id: wallets.id,
        address: wallets.address,
        chain: wallets.chain,
        sanctions_status: wallets.sanctions_status,
      })
      .from(wallets)
      .where(eq(wallets.address, normalizedAddress))
      .limit(1)
  );

  if (error) {
    console.error(
      `[resolveOrOnboardWalletPrincipal] DB error looking up wallet: ${error.message}`
    );
    return { ok: false };
  }
  return { ok: true, wallet: walletRows[0] ?? null };
}

interface OnboardWalletResult {
  principal_id: string;
  wallet_id: string;
  is_new: boolean;
}

function parseOnboardWalletResult(result: unknown): OnboardWalletResult | null {
  if (
    typeof result !== "object" ||
    result === null ||
    !("principal_id" in result) ||
    !("wallet_id" in result) ||
    !("is_new" in result)
  ) {
    return null;
  }
  const { principal_id: principalId, wallet_id: walletId, is_new: isNew } = result;
  if (
    typeof principalId !== "string" ||
    typeof walletId !== "string" ||
    typeof isNew !== "boolean"
  ) {
    return null;
  }
  return { principal_id: principalId, wallet_id: walletId, is_new: isNew };
}

function buildDisposition(
  wallet: WalletRow,
  isNewWallet: boolean
): ResolveOrOnboardWalletPrincipalResult {
  const principal: WalletPrincipal = {
    kind: "wallet",
    principalId: wallet.id,
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
      message:
        "This wallet has been flagged by sanctions screening and cannot transact.",
      principal,
    };
  }
  return { ok: true, isNewWallet, principal };
}
