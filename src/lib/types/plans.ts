export interface Plan {
  title: string;
  monthlyPrice: number;
  yearlyPrice: number;
  monthlyYearlyprice: number;
  description: string;
  features: string[];
  priceIdMonthly: string;
  priceIdYearly: string;
  actionLabel: string;
  popular?: boolean;
}

// Just check the environment
const isProd = process.env.NODE_ENV === "production";

// Define the dev version (your existing array)
const devPlanPrices = [
  // Basic plan
  {
    title: "Starter",
    monthlyPrice: 9,
    yearlyPrice: 64,
    monthlyYearlyprice: 5.39,
    description: "For individual content creators just getting started",
    features: [
      "5 connected social accounts",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 5 GB",
    ],
    priceIdMonthly: "price_1RKr9JCZd1WOWtsDVHl5MsP6",
    priceIdYearly: "price_1RKrGNCZd1WOWtsDcU2r7iNf",
    actionLabel: "Get Started",
  },

  // Pro plan
  {
    title: "Creator",
    monthlyPrice: 18,
    yearlyPrice: 129,
    monthlyYearlyprice: 10.75,
    description: "Perfect for owners of small & medium businesses",
    features: [
      "**15 connected social accounts**",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 15 GB",
    ],
    priceIdMonthly: "price_1RKrAsCZd1WOWtsDt1phjbgI",
    priceIdYearly: "price_1RKrGiCZd1WOWtsDOOQ4l3wH",
    actionLabel: "Subscribe Now",
    popular: true,
  },

  // Business plan
  {
    title: "Pro ",
    monthlyPrice: 27,
    yearlyPrice: 194,
    monthlyYearlyprice: 16.17,
    description: "Advanced features for larger organizations",
    features: [
      "**Unlimited connected accounts**",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 45 GB",
    ],
    priceIdMonthly: "price_1RKrCRCZd1WOWtsDRzjqHluX",
    priceIdYearly: "price_1RKrGyCZd1WOWtsD2avrk52o",
    actionLabel: "Get Started",
  },
];

// Define the prod version (exact copy with only price IDs changed)
const prodPlanPrices = [
  // Basic plan
  {
    title: "Starter",
    monthlyPrice: 9,
    yearlyPrice: 64,
    monthlyYearlyprice: 5.39,
    description: "For individual content creators just getting started",
    features: [
      "5 connected social accounts",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 5 GB",
    ],
    priceIdMonthly: "price_1RNMXJCyG8V2WH2FUpSI7VJt",
    priceIdYearly: "price_1RNMXJCyG8V2WH2FLLApU9iL",
    actionLabel: "Get Started",
  },

  // Pro plan
  {
    title: "Creator",
    monthlyPrice: 18,
    yearlyPrice: 129,
    monthlyYearlyprice: 10.75,
    description: "Perfect for owners of small & medium businesses",
    features: [
      "**15 connected social accounts**",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 15 GB",
    ],
    priceIdMonthly: "price_1RNMXHCyG8V2WH2Fq3TC2YwY",
    priceIdYearly: "price_1RNMXHCyG8V2WH2FJJWCcCk4",
    actionLabel: "Subscribe Now",
    popular: true,
  },

  // Business plan
  {
    title: "Pro ",
    monthlyPrice: 27,
    yearlyPrice: 194,
    monthlyYearlyprice: 16.17,
    description: "Advanced features for larger organizations",
    features: [
      "**Unlimited connected accounts**",
      "Multiple accounts per platform",
      "Unlimited posts",
      "Schedule posts",
      "Storage 45 GB",
    ],
    priceIdMonthly: "price_1RNMXECyG8V2WH2FxDDhYNy8",
    priceIdYearly: "price_1RNMXDCyG8V2WH2Fz1ae60z4",
    actionLabel: "Get Started",
  },
];

// Export the right array based on environment
export const planPrices = isProd ? prodPlanPrices : devPlanPrices;

// Tier-keyed storage limits in bytes.
export const TIER_STORAGE_LIMITS: Record<PlanTier, number> = {
  starter: 5  * 1024 * 1024 * 1024,
  creator: 15 * 1024 * 1024 * 1024,
  pro:     45 * 1024 * 1024 * 1024,
};

// Fallback for users with no resolvable tier (most restrictive cap).
export const DEFAULT_STORAGE_LIMIT: number = 5 * 1024 * 1024 * 1024; // 5 GB

/**
 * Tier hierarchy used by MCP entitlement gates and any other code
 * that needs to compare plan levels. Order is rank: higher index
 * grants access to lower-rank actions.
 */
export const TIER_RANK = ["starter", "creator", "pro"] as const;
export type PlanTier = (typeof TIER_RANK)[number];

/**
 * Maps Stripe price IDs to plan tiers. Built at module load by
 * walking BOTH dev and prod arrays so the same code works in any
 * environment without rebuilding the mapping per request.
 *
 * Stripe price IDs are case-sensitive. Keys retain their original case.
 */
function buildPriceIdToTierMap(): Record<string, PlanTier> {
  const map: Record<string, PlanTier> = {};
  const allPlans = [...devPlanPrices, ...prodPlanPrices];
  for (const plan of allPlans) {
    const tier = normalizePlanTitleToTier(plan.title);
    if (tier === null) continue;
    map[plan.priceIdMonthly] = tier;
    map[plan.priceIdYearly] = tier;
  }
  return map;
}

/**
 * Note the trailing space on "Pro " in the planPrices arrays.
 * trim() handles it.
 */
function normalizePlanTitleToTier(title: string): PlanTier | null {
  const t = title.trim().toLowerCase();
  if (t === "starter") return "starter";
  if (t === "creator") return "creator";
  if (t === "pro") return "pro";
  return null;
}

const PRICE_ID_TO_TIER: Record<string, PlanTier> = buildPriceIdToTierMap();

/**
 * Resolve a Stripe price ID to a plan tier.
 * Returns null for null or unknown IDs (fail-closed).
 * Logs unknown non-null IDs because they indicate config drift
 * between Stripe and planPrices.
 */
export function priceIdToTier(priceId: string | null): PlanTier | null {
  if (priceId === null) return null;
  const tier = PRICE_ID_TO_TIER[priceId];
  if (tier === undefined) {
    console.error(
      `[plans.priceIdToTier] Unknown Stripe price ID "${priceId}". ` +
        `Add it to planPrices or stripe_subscriptions has stale data. ` +
        `Returning null.`,
    );
    return null;
  }
  return tier;
}

/**
 * True iff actual tier meets or exceeds required tier.
 */
export function tierMeets(actual: PlanTier | null, required: PlanTier): boolean {
  if (actual === null) return false;
  return TIER_RANK.indexOf(actual) >= TIER_RANK.indexOf(required);
}

/**
 * Human-readable label for tier (UI/error messages).
 */
export function tierLabel(tier: PlanTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}

export const TIER_ACCOUNT_LIMITS: Record<PlanTier, number> = {
  starter: 5,
  creator: 15,
  pro: Number.POSITIVE_INFINITY,
};
