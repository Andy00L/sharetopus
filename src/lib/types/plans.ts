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
export const STORAGE_LIMITS = isProd
  ? PRICE_ID_STORAGE_LIMITS
  : DEV_PRICE_ID_STORAGE_LIMITS;

// Export the right account limits based on environment
export const PRICE_ID_ACCOUNT_LIMITS: Record<string, number> = isProd
  ? prodPriceIdAccountLimits
  : devPriceIdAccountLimits;

// Default limit for unknown subscription IDs
export const DEFAULT_ACCOUNT_LIMIT = 0;
