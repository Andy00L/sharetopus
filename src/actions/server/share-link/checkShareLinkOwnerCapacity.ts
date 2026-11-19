import "server-only";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkAccountLimits } from "@/actions/server/connections/checkAccountLimits";

export type OwnerCapacityRefusal =
  | "owner_subscription_inactive"
  | "owner_account_limit_reached"
  | "owner_check_failed";

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
