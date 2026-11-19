"use server";

import { auth } from "@clerk/nextjs/server";

import {
  loadReferralProgress,
  type ReferralProgressResult,
} from "./loadReferralProgress";

export async function getReferralProgress(): Promise<ReferralProgressResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Not signed in" };
  }
  return loadReferralProgress(userId);
}
