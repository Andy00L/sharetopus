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

// Same for the account limits
const devPriceIdAccountLimits: Record<string, number> = {
  // Starter plan - 5 accounts
  price_1RKr9JCZd1WOWtsDVHl5MsP6: 5, // Monthly
  price_1RKrGNCZd1WOWtsDcU2r7iNf: 5, // Yearly

  // Creator plan - 15 accounts
  price_1RKrAsCZd1WOWtsDt1phjbgI: 15, // Monthly
  price_1RKrGiCZd1WOWtsDOOQ4l3wH: 15, // Yearly

  // Pro plan - Unlimited (use a very high number)
  price_1RKrCRCZd1WOWtsDRzjqHluX: 999, // Monthly
  price_1RKrGyCZd1WOWtsD2avrk52o: 999, // Yearly

  // Temporary dev test plan - 5 accounts
  price_1TBCLaCyG8V2WH2Ff8AhK1zC: 5,
};

const prodPriceIdAccountLimits: Record<string, number> = {
  // Starter plan - 5 accounts
  price_1RNMXJCyG8V2WH2FUpSI7VJt: 5, // Monthly
  price_1RNMXJCyG8V2WH2FLLApU9iL: 5, // Yearly

  // Creator plan - 15 accounts
  price_1RNMXHCyG8V2WH2Fq3TC2YwY: 15, // Monthly
  price_1RNMXHCyG8V2WH2FJJWCcCk4: 15, // Yearly

  // Pro plan - Unlimited
  price_1RNMXECyG8V2WH2FxDDhYNy8: 999, // Monthly
  price_1RNMXDCyG8V2WH2Fz1ae60z4: 999, // Yearly
};

// Storage limits in bytes
export const PRICE_ID_STORAGE_LIMITS: Record<string, number> = {
  // Starter plan - 5GB storage
  price_1RNMXJCyG8V2WH2FUpSI7VJt: 5 * 1024 * 1024 * 1024,
  price_1RNMXJCyG8V2WH2FLLApU9iL: 5 * 1024 * 1024 * 1024,

  // Creator plan - 15GB storage
  price_1RNMXHCyG8V2WH2Fq3TC2YwY: 15 * 1024 * 1024 * 1024,
  price_1RNMXHCyG8V2WH2FJJWCcCk4: 15 * 1024 * 1024 * 1024,

  // Pro plan - 45GB storage
  price_1RNMXECyG8V2WH2FxDDhYNy8: 45 * 1024 * 1024 * 1024,
  price_1RNMXDCyG8V2WH2Fz1ae60z4: 45 * 1024 * 1024 * 1024,
};

// Dev environment storage limits
const DEV_PRICE_ID_STORAGE_LIMITS: Record<string, number> = {
  // Dev Starter plan - 5GB storage
  price_1RKr9JCZd1WOWtsDVHl5MsP6: 5 * 1024 * 1024 * 1024,
  price_1RKrGNCZd1WOWtsDcU2r7iNf: 5 * 1024 * 1024 * 1024,

  // Dev Creator plan - 15GB storage
  price_1RKrAsCZd1WOWtsDt1phjbgI: 15 * 1024 * 1024 * 1024,
  price_1RKrGiCZd1WOWtsDOOQ4l3wH: 15 * 1024 * 1024 * 1024,

  // Dev Pro plan - 45GB storage
  price_1RKrCRCZd1WOWtsDRzjqHluX: 45 * 1024 * 1024 * 1024,
  price_1RKrGyCZd1WOWtsD2avrk52o: 45 * 1024 * 1024 * 1024,

  // Temporary dev test plan - 5GB storage
  price_1TBCLaCyG8V2WH2Ff8AhK1zC: 5 * 1024 * 1024 * 1024,
};

// Export based on environment
export const STORAGE_LIMITS: Record<string, number> = isProd
  ? PRICE_ID_STORAGE_LIMITS
  : DEV_PRICE_ID_STORAGE_LIMITS;

// Default storage limit for unknown/missing price IDs (most restrictive tier)
export const DEFAULT_STORAGE_LIMIT: number = 5 * 1024 * 1024 * 1024; // 5 GB

// Export the right account limits based on environment
export const PRICE_ID_ACCOUNT_LIMITS: Record<string, number> = isProd
  ? prodPriceIdAccountLimits
  : devPriceIdAccountLimits;

// Default limit for unknown subscription IDs
export const DEFAULT_ACCOUNT_LIMIT = 0;

/**
 * Tier hierarchy used by MCP entitlement gates and any other code
 * that needs to compare plan levels. Order is rank: higher index
 * grants access to lower-rank actions.
 */
export const TIER_RANK = ["free", "starter", "creator", "pro"] as const;
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
 * Returns "free" for null or unknown IDs (fail-closed default).
 * Logs unknown non-null IDs because they indicate config drift
 * between Stripe and planPrices.
 */
export function priceIdToTier(priceId: string | null): PlanTier {
  if (priceId === null) return "free";
  const tier = PRICE_ID_TO_TIER[priceId];
  if (tier === undefined) {
    console.error(
      `[plans.priceIdToTier] Unknown Stripe price ID "${priceId}". ` +
      `Add it to planPrices or stripe_subscriptions has stale data. ` +
      `Defaulting to "free".`,
    );
    return "free";
  }
  return tier;
}

/**
 * True iff actual tier meets or exceeds required tier.
 */
export function tierMeets(actual: PlanTier, required: PlanTier): boolean {
  return TIER_RANK.indexOf(actual) >= TIER_RANK.indexOf(required);
}

/**
 * Human-readable label for tier (UI/error messages).
 */
export function tierLabel(tier: PlanTier): string {
  return tier.charAt(0).toUpperCase() + tier.slice(1);
}
