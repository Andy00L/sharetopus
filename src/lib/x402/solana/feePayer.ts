import "server-only";

import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import { getNetworkConfig } from "@/lib/x402/networks";

const FEE_PAYER_TTL_MS = 10 * 60 * 1000;

// @x402/core keys /supported signers by the scheme's CAIP family (node_modules/@x402/core/dist/esm/facilitator/index.mjs getSupported).
const SOLANA_SIGNERS_KEY = "solana:*";

interface FeePayerCacheEntry {
  feePayer: string;
  // CDP rotates the advertised feePayer within this signer set between /supported calls (observed live, June 2026).
  signers: readonly string[];
  fetchedAt: number;
}

let feePayerCache: FeePayerCacheEntry | null = null;

export type FeePayerResult =
  | { ok: true; feePayer: string }
  | { ok: false; message: string };

export async function getSolanaFeePayer(): Promise<FeePayerResult> {
  const nowMs = Date.now();
  if (feePayerCache && nowMs - feePayerCache.fetchedAt < FEE_PAYER_TTL_MS) {
    return { ok: true, feePayer: feePayerCache.feePayer };
  }

  const fetchResult = await fetchSolanaFeePayerFromFacilitator();
  if (fetchResult.ok) {
    feePayerCache = { ...fetchResult.entry, fetchedAt: nowMs };
    return { ok: true, feePayer: fetchResult.entry.feePayer };
  }

  if (feePayerCache) {
    console.warn(
      `[getSolanaFeePayer] /supported refetch failed (${fetchResult.message}); serving stale fee payer cached at ${new Date(feePayerCache.fetchedAt).toISOString()}.`
    );
    return { ok: true, feePayer: feePayerCache.feePayer };
  }

  return { ok: false, message: fetchResult.message };
}

export function readCachedSolanaSigners(): readonly string[] {
  return feePayerCache?.signers ?? [];
}

async function fetchSolanaFeePayerFromFacilitator(): Promise<
  | { ok: true; entry: { feePayer: string; signers: readonly string[] } }
  | { ok: false; message: string }
> {
  const solanaNetwork = getNetworkConfig("solana");
  if (!solanaNetwork) {
    return { ok: false, message: "Solana is not in the network registry." };
  }

  const facilitatorResult = getFacilitatorClient(solanaNetwork);
  if (!facilitatorResult.ok) return { ok: false, message: facilitatorResult.message };
  const facilitator = facilitatorResult.client;

  try {
    if (!facilitator.getSupported) {
      return {
        ok: false,
        message:
          "The facilitator serving Solana does not advertise a /supported endpoint.",
      };
    }
    const supported = await facilitator.getSupported();

    const solanaKind = supported.kinds.find(
      (kind) =>
        kind.scheme === "exact" && kind.network === solanaNetwork.caipNetwork
    );
    const feePayer = solanaKind?.extra?.feePayer;
    if (typeof feePayer !== "string" || feePayer.length === 0) {
      return {
        ok: false,
        message:
          "Facilitator /supported response carries no Solana exact-scheme feePayer.",
      };
    }

    const advertisedSigners = (supported.signers[SOLANA_SIGNERS_KEY] ?? []).filter(
      (signerAddress) => typeof signerAddress === "string" && signerAddress.length > 0
    );
    const signers = advertisedSigners.includes(feePayer)
      ? advertisedSigners
      : [...advertisedSigners, feePayer];

    return { ok: true, entry: { feePayer, signers } };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Unknown facilitator error during /supported.",
    };
  }
}
