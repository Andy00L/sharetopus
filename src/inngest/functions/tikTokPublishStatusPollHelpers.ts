import "server-only";

import { fetchAccountForPublish } from "@/actions/server/data/fetchAccountForPublish";
import { ensureValidToken } from "@/lib/api/ensureValidToken";

// Call it inside the step that uses the token; never return the token
// from a step, because Inngest stores step results.
export async function resolveTikTokAccessTokenForAccount(
  social_account_id: string
): Promise<
  { success: true; token: string } | { success: false; message: string }
> {
  const fetched = await fetchAccountForPublish(social_account_id);
  if (!fetched.success) {
    return { success: false, message: fetched.message };
  }

  const tokenResult = await ensureValidToken(fetched.account);

  if (!tokenResult.success || !tokenResult.token) {
    return {
      success: false,
      message:
        tokenResult.error ?? "Token resolution returned no token",
    };
  }

  return { success: true, token: tokenResult.token };
}
