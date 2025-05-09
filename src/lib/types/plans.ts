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
    ],
    priceIdMonthly: "price_1RKrCRCZd1WOWtsDRzjqHluX",
    priceIdYearly: "price_1RKrGyCZd1WOWtsD2avrk52o",
    actionLabel: "Get Started",
  },
];
