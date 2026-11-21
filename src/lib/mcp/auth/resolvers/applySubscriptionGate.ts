import "server-only";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import type {
  GatablePrincipal,
  PrincipalResolution,
} from "@/lib/types/principal";

import {
  getCachedSubscription,
  setCachedSubscription,
} from "./subscriptionCache";

export async function applySubscriptionGate<T extends GatablePrincipal>(
  candidate: T,
): Promise<PrincipalResolution<T>> {
  const cached = getCachedSubscription(candidate.principalId);
  if (cached) {
    if (!cached.isActive) return { status: "rejected" };
    return { status: "resolved", principal: { ...candidate, priceId: cached.priceId, plan: cached.plan } };
  }

  const sub = await checkActiveSubscription(candidate.principalId);

  if (sub.status === "unavailable") {
    console.error(
      `[applySubscriptionGate] Subscription check failed for ${candidate.principalId}`,
    );
    return { status: "unavailable" };
  }

  if (!sub.isActive) {
    setCachedSubscription(candidate.principalId, {
      isActive: false,
      plan: null,
      priceId: null,
    });
    console.log(
      `[applySubscriptionGate] Principal ${candidate.principalId} has no active subscription`,
    );
    return { status: "rejected" };
  }

  setCachedSubscription(candidate.principalId, {
    isActive: true,
    plan: sub.tier,
    priceId: sub.priceId,
  });

  return { status: "resolved", principal: { ...candidate, priceId: sub.priceId, plan: sub.tier } };
}
