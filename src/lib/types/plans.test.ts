import { describe, expect, test } from "bun:test";

import { planPrices, priceIdToTier, TIER_RANK } from "./plans";

describe("priceIdToTier", () => {
  test("every listed plan's monthly and yearly price resolves to its tier", () => {
    const resolvedTiers = planPrices.map((plan) => [
      priceIdToTier(plan.priceIdMonthly),
      priceIdToTier(plan.priceIdYearly),
    ]);
    expect(resolvedTiers).toEqual(TIER_RANK.map((tier) => [tier, tier]));
  });
});
