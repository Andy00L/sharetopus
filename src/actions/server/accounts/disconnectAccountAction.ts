// actions/server/accounts/disconnectAction.ts
"use server";

import { disconnectSocialAccountProtected } from "../../functionWithRateLimit";

export async function disconnectAccountAction(
  accountId: string,
  userId: string
) {
  const result = await disconnectSocialAccountProtected(accountId, userId);
  return result;
}
