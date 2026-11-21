import "server-only";

import { sql } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { invalidateCachedSubscription } from "@/lib/mcp/auth/resolvers/subscriptionCache";

export async function triggerReferralGrant(
  referrerId: string,
): Promise<
  { success: true; weeksGranted: number } | { success: false; message: string }
> {
  const { data: grantRows, error: rpcError } = await runQuery(
    db.execute(
      sql`select public.grant_referral_rewards(${referrerId}) as weeks_granted`,
    ),
  );

  if (rpcError) {
    console.error(
      `[triggerReferralGrant] RPC failed for referrer ${referrerId}:`,
      rpcError.message,
    );
    return { success: false, message: "Reward grant RPC failed" };
  }

  // The function returns int4, which db.execute hands back as a number.
  const weeksGranted: unknown = grantRows[0]?.weeks_granted;
  const grantedWeeks = typeof weeksGranted === "number" ? weeksGranted : 0;

  if (grantedWeeks > 0) {
    invalidateCachedSubscription(referrerId);
    console.log(
      `[triggerReferralGrant] Granted ${grantedWeeks} week(s) to referrer ${referrerId}, cache invalidated`,
    );
  }

  return { success: true, weeksGranted: grantedWeeks };
}
