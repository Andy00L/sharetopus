import "server-only";

import {
  checkActiveSubscription,
  needsOwnerAccessToPublish,
} from "@/actions/checkActiveSubscription";
import type { CreatedVia } from "@/db/schema";

export const REVIVE_NEEDS_ACCESS_MESSAGE =
  "Bringing back a cancelled post needs an active plan or referral weeks. Renew your subscription, then try again.";

export const REVIVE_ACCESS_UNAVAILABLE_MESSAGE =
  "Could not check your plan, so nothing changed. Please try again.";

export type ReviveAccessCheck =
  | { ok: true }
  | { ok: false; failure: "no_access" | "unavailable"; message: string };

export async function checkAccessToRevivePosts(input: {
  principalId: string;
  revivedPosts: readonly { created_via: CreatedVia }[];
}): Promise<ReviveAccessCheck> {
  if (!input.revivedPosts.some(needsOwnerAccessToPublish)) return { ok: true };

  const access = await checkActiveSubscription(input.principalId);
  if (access.status === "unavailable") {
    return { ok: false, failure: "unavailable", message: REVIVE_ACCESS_UNAVAILABLE_MESSAGE };
  }
  if (!access.isActive) {
    return { ok: false, failure: "no_access", message: REVIVE_NEEDS_ACCESS_MESSAGE };
  }
  return { ok: true };
}
