import "server-only";
import {
  PRICE_ID_UPLOAD_LIMITS,
  DEFAULT_UPLOAD_LIMITS,
} from "@/components/core/create/constants/uploadLimits";

export type UploadLimits = { image: number; video: number };

/**
 * Resolves upload size caps (MB) for a principal based on their Stripe
 * price ID. The price ID is already available on McpPrincipal.priceId
 * (resolved in auth.ts via checkActiveSubscription), so no DB query is
 * needed here.
 *
 * Fallback behavior (all return DEFAULT_UPLOAD_LIMITS):
 *   - null price ID (wallet principals / x402)
 *   - unknown price ID (logs a warning for config drift)
 *   - inactive or cancelled subscriptions (auth layer already blocks
 *     these, but this is belt-and-suspenders)
 */
export function getUploadLimitsForPrincipal(
  priceId: string | null,
): UploadLimits {
  if (!priceId) return DEFAULT_UPLOAD_LIMITS;

  const limits = PRICE_ID_UPLOAD_LIMITS[priceId];
  if (!limits) {
    console.warn("[getUploadLimitsForPrincipal] unknown price_id", { priceId });
    return DEFAULT_UPLOAD_LIMITS;
  }

  return limits;
}
