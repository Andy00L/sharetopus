import { beforeEach, describe, expect, mock, test } from "bun:test";
import { drizzle } from "drizzle-orm/postgres-js";

import type { ReferralStanding } from "./loadReferralStanding";

const queuedStandings: ReferralStanding[] = [];
const grantedReferrerIds: string[] = [];
let isGrantFailing = false;

mock.module("server-only", () => ({}));

mock.module("@/db/client", () => ({
  db: drizzle.mock(),
  runQuery: async () => ({ data: [queuedStandings.shift()], error: null }),
}));

mock.module("./triggerReferralGrant", () => ({
  triggerReferralGrant: async (referrerId: string) => {
    grantedReferrerIds.push(referrerId);
    return isGrantFailing
      ? { success: false, message: "RPC failed" }
      : { success: true, weeksGranted: 1 };
  },
}));

const { loadSettledReferralStanding } = await import("./loadReferralStanding");

function standingOf(verifiedCount: number, weeksEarned: number): ReferralStanding {
  return { verifiedCount, redeemedCount: weeksEarned * 3, weeksEarned, creatorAccessUntil: null };
}

beforeEach(() => {
  queuedStandings.length = 0;
  grantedReferrerIds.length = 0;
  isGrantFailing = false;
});

describe("loadSettledReferralStanding", () => {
  test("grants a full batch a failed grant left unredeemed, then returns the new standing", async () => {
    queuedStandings.push(standingOf(3, 0), standingOf(0, 1));

    const result = await loadSettledReferralStanding("user_referrer");

    expect(grantedReferrerIds).toEqual(["user_referrer"]);
    expect(result).toEqual({ success: true, standing: standingOf(0, 1) });
  });

  test("does not call the grant below a full batch or at the cap", async () => {
    queuedStandings.push(standingOf(2, 0));
    await loadSettledReferralStanding("user_short");
    queuedStandings.push(standingOf(3, 5));
    await loadSettledReferralStanding("user_capped");

    expect(grantedReferrerIds).toEqual([]);
  });

  test("returns the unsettled standing when the grant fails again", async () => {
    isGrantFailing = true;
    queuedStandings.push(standingOf(3, 0));

    const result = await loadSettledReferralStanding("user_referrer");

    expect(result).toEqual({ success: true, standing: standingOf(3, 0) });
  });
});
