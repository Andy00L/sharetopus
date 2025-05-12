// actions/server/accounts/disconnectAction.ts
"use server";

import { disconnectSocialAccount } from "./disconnectSocialAccount";

export async function disconnectAccountAction(
  accountId: string,
  userId: string
) {
  const result = await disconnectSocialAccount(accountId, userId);
  return result;
}
