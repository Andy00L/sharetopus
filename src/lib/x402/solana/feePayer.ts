import "server-only";

/**
 * Facilitator fee payer for SVM (Solana) exact-scheme payments.
 *
 * The official @x402/svm client refuses to build a payment unless the 402's
 * accepts entry carries extra.feePayer (the facilitator's fee-payer pubkey),
 * and the facilitator's verify rejects requirements whose feePayer is not in
 * its signer set. The value comes from the facilitator /supported endpoint:
 * the kinds[] entry for scheme "exact" on the Solana CAIP-2 network, field
 * extra.feePayer. The signers["solana:*"] set is cached alongside it because
 * the advertised feePayer rotates randomly within that set between
 * /supported calls (observed live against CDP, June 2026), so payer
 * extraction removes set members, not just the one cached value.
 *
 * Called by: http/paymentHttp.ts (requirements builder),
 *            payment/paymentPayload.ts (payer extraction, sync cache read)
 * Tables touched: none
 */

import { getFacilitatorClient } from "@/lib/x402/facilitatorClient";
import { getNetworkConfig } from "@/lib/x402/networks";

/** Cache TTL in milliseconds (10 minutes; June 2026 checkpoint decision). */
const FEE_PAYER_TTL_MS = 10 * 60 * 1000;

/** Signers map key for Solana. sourceRef: live CDP /supported response. */
const SOLANA_SIGNERS_KEY = "solana:*";

interface FeePayerCacheEntry {
  feePayer: string;
  signers: readonly string[];
  fetchedAt: number;
}

let feePayerCache: FeePayerCacheEntry | null = null;

export type FeePayerResult =
  | { ok: true; feePayer: string }
  | { ok: false; message: string };

/**
 * Facilitator fee payer for Solana, cached in module memory. Serves the
 * cached value inside the TTL; on refetch failure it serves the stale value
 * with a warning; with nothing cached at all it returns the failure variant.
 * Never throws.
 */
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

/**
 * Facilitator Solana signer set from the same cache, for synchronous use in
 * payment-payload extraction (which must never trigger a network fetch).
 * Empty when nothing has been cached yet; extraction then falls back to the
 * positional rule (fee payer at static account index 0).
 */
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

  try {
    const facilitator = getFacilitatorClient();
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

    // Runtime hardening: signers comes off the wire; keep only real strings.
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
