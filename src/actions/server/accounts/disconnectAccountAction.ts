"use server";

import { auth } from "@clerk/nextjs/server";

import {
  disconnectSocialAccount,
  type DisconnectSocialAccountResult,
} from "./disconnectSocialAccount";

export async function disconnectAccountAction(
  accountId: string,
): Promise<DisconnectSocialAccountResult> {
  const { userId } = await auth();
  if (!userId) {
    return {
      success: false,
      message: "Authentication validation failed. Please sign in again.",
    };
  }
  return disconnectSocialAccount(accountId, userId);
}
