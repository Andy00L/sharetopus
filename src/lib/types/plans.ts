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
export const planPrices = [
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
      "250MB Upload",
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
      "750MB Upload",
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
      "Storage 30 GB",
      "1.5GB Upload",
    ],
    priceIdMonthly: "price_1RKrCRCZd1WOWtsDRzjqHluX",
    priceIdYearly: "price_1RKrGyCZd1WOWtsD2avrk52o",
    actionLabel: "Get Started",
  },
];

// config/subscriptionPlans.ts
export const PLAN_ACCOUNT_LIMITS = {
  starter: 3,
  pro: 10,
  business: 25,
};

// config/subscriptionLimits.ts
export const PRICE_ID_ACCOUNT_LIMITS: Record<string, number> = {
  // Starter plan - 5 accounts
  price_1RKr9JCZd1WOWtsDVHl5MsP6: 5, // Monthly
  price_1RKrGNCZd1WOWtsDcU2r7iNf: 5, // Yearly

  // Creator plan - 15 accounts
  price_1RKrAsCZd1WOWtsDt1phjbgI: 15, // Monthly
  price_1RKrGiCZd1WOWtsDOOQ4l3wH: 15, // Yearly

  // Pro plan - Unlimited (use a very high number)
  price_1RKrCRCZd1WOWtsDRzjqHluX: 999, // Monthly
  price_1RKrGyCZd1WOWtsD2avrk52o: 999, // Yearly
};

// Default limit for unknown subscription IDs
export const DEFAULT_ACCOUNT_LIMIT = 0;
