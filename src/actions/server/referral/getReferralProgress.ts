"use server";

import { auth } from "@clerk/nextjs/server";

import {
  loadReferralProgress,
  type ReferralProgressResult,
} from "./loadReferralProgress";

/**
 * Referral progress for the signed-in user, for the sidebar badge.
 *
 * This is a server action, so any argument would be client input: the user
 * comes from the Clerk session instead, and nobody can read another user's
 * referral counts through it.
 *
 * Called by: NavReferral (src/components/sidebar/nav-referral.tsx)
 */
export async function getReferralProgress(): Promise<ReferralProgressResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Not signed in" };
  }
  return loadReferralProgress(userId);
}
