import "server-only";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";

/** Why a share link's owner cannot take another connected account. */
export type OwnerCapacityRefusal =
  | "owner_subscription_inactive"
  | "owner_account_limit_reached"
  | "owner_check_failed";

/**
 * Whether a share link's owner can take one more connected account: an
 * active plan with room under its account limit. A failed read is its own
 * answer, "owner_check_failed", so the visitor is asked to retry instead of
 * being told the owner is out of room. Both used to read as
 * "owner_account_limit_reached", a lapsed plan included.
 *
 * Called by: the share landing page, the share initiate route, and the OAuth
 * callback's re-check (handleOAuthCallback)
 */
export async function checkShareLinkOwnerCapacity(
  ownerPrincipalId: string,
): Promise<{ ok: true } | { ok: false; reason: OwnerCapacityRefusal }> {
  const subscription = await checkActiveSubscription(ownerPrincipalId);
  if (subscription.status === "unavailable") {
    return { ok: false, reason: "owner_check_failed" };
  }
  if (!subscription.isActive) {
    return { ok: false, reason: "owner_subscription_inactive" };
  }

  const limits = await checkAccountLimits(ownerPrincipalId, subscription.tier);
  if (!limits.success) {
    return { ok: false, reason: "owner_check_failed" };
  }
  if (!limits.canAddMore) {
    return { ok: false, reason: "owner_account_limit_reached" };
  }
  return { ok: true };
}
