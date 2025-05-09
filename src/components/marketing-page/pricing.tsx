"use client";
import { getStripeSession } from "@/actions/server/stripe/checkOutSession";
import { checkUserSubscription } from "@/actions/server/stripe/checkUserSubscription";
import { CreateCustomerPortal } from "@/actions/server/stripe/customerPortal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Plan, planPrices } from "@/lib/types/plans";
import { useAuth } from "@clerk/nextjs";
import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PricingSection() {
  const [isYearly, setIsYearly] = useState(true);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  // Function to render feature text with bold formatting if needed
  const renderFeatureText = (feature: string) => {
    if (feature.startsWith("**") && feature.endsWith("**")) {
      const boldText = feature.slice(2, -2);
      return (
        <span>
          <strong>{boldText}</strong>
        </span>
      );
    }
    return <span>{feature}</span>;
  };

  // Calculate the savings amount for yearly plans
  const calculateSavings = (plan: Plan) => {
    return Math.round(plan.monthlyPrice * 12 - plan.yearlyPrice);
  };

  // Calculate discount percentage based on the actual price difference
  const calculateDiscountPercentage = (plan: Plan) => {
    return Math.round(
      ((plan.monthlyPrice - plan.monthlyYearlyprice) / plan.monthlyPrice) * 100
    );
  };

  // Handle button click to subscribe
  const handleSubscribe = async (plan: Plan) => {
    try {
      setLoadingPlan(plan.title);

      if (!isLoaded) {
        // Auth isn't loaded yet, wait briefly
        return;
      }

      // If user is not signed in, redirect to sign-up
      if (!isSignedIn) {
        router.push("/create"); // Redirect to Clerk sign-up page
        return;
      }
      // Check if user has an active subscription
      const hasActiveSubscription = await checkUserSubscription(); // You'd need to create this
      let redirectUrl;
      if (hasActiveSubscription) {
        // This will redirect the user directly
        redirectUrl = await CreateCustomerPortal();
      } else {
        // This would also use redirect internally
        const priceId = isYearly ? plan.priceIdYearly : plan.priceIdMonthly;

        redirectUrl = await getStripeSession({ priceId });
      }

      // Note: Code here might not run if redirect happens
      // If we got a valid URL back, redirect the browser
      if (redirectUrl) {
        window.location.href = redirectUrl;
      } else {
        // Handle error
        console.error("Failed to get redirect URL");
        setLoadingPlan(null);
      }
    } catch (error) {
      console.error("Error during subscription process::", error);
      setLoadingPlan(null);
    }
  };

  return (
    <section className="py-24 bg-white" id="pricing">
      <div className="container mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-block px-3 py-1 mb-6 rounded-full bg-primary/10 text-primary text-sm font-medium">
            Simple Pricing
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
            Choose the Right Plan for Your Social Media Needs
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            No matter your size, we have a plan that fits your social media
            management needs.
          </p>

          {/* Billing period toggle */}
          <div className="flex items-center justify-center mt-8 ">
            <span
              className={`mr-3 ${
                !isYearly ? "font-medium" : "text-muted-foreground"
              }`}
            >
              Monthly
            </span>
            <button
              onClick={() => setIsYearly(!isYearly)}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-primary/20 cursor-pointer"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-primary transition ${
                  isYearly ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
            <span
              className={`ml-3 ${
                isYearly ? "font-medium" : "text-muted-foreground"
              }`}
            >
              Yearly
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          {planPrices.map((plan) => {
            const discountPercentage = calculateDiscountPercentage(plan);
            const isLoading = loadingPlan === plan.title;

            return (
              <Card
                key={plan.title}
                className={`relative overflow-hidden flex flex-col ${
                  plan.popular
                    ? "border-primary/30 shadow-md hover:shadow-lg transition-shadow scale-105 z-10"
                    : "border-border/40 shadow-sm hover:shadow-md transition-shadow"
                }`}
              >
                {isYearly && (
                  <div className="absolute top-4 right-4 bg-red-400 text-white px-3 py-1 text-xs font-medium rounded-full">
                    {discountPercentage}% OFF
                  </div>
                )}

                {plan.popular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-green-500 text-white px-4 py-1 text-xs font-medium rounded-full">
                    Most popular
                  </div>
                )}

                {plan.popular && (
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 bg-green-500 text-white px-4 py-1 text-xs font-medium rounded-full">
                    Best deal
                  </div>
                )}

                <CardHeader className="pb-4 pt-6">
                  <CardTitle className="text-2xl">{plan.title}</CardTitle>
                  <CardDescription className="mt-1">
                    {plan.description}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-grow">
                  <div className="mb-6">
                    <div className="flex items-baseline">
                      <span className="text-5xl font-bold">
                        $
                        {isYearly ? plan.monthlyYearlyprice : plan.monthlyPrice}
                      </span>
                      <span className="text-lg text-muted-foreground ml-1">
                        /month
                      </span>
                    </div>

                    {isYearly && (
                      <>
                        <div className="text-sm text-muted-foreground mt-1">
                          Billed as ${plan.yearlyPrice}/year
                        </div>
                        <div className="text-sm text-green-500 font-medium mt-1">
                          Save ${calculateSavings(plan)} with yearly pricing (
                          {discountPercentage}% off)
                        </div>
                      </>
                    )}
                  </div>

                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start">
                        <Check
                          size={20}
                          className="mr-3 text-green-500 shrink-0 mt-0.5"
                        />
                        {renderFeatureText(feature)}
                      </li>
                    ))}
                  </ul>
                </CardContent>

                <CardFooter className="pt-4">
                  <Button
                    variant={plan.popular ? "default" : "outline"}
                    className="w-full group cursor-pointer"
                    onClick={() => handleSubscribe(plan)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <div className="flex items-center justify-center">
                        <svg
                          className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Processing...
                      </div>
                    ) : (
                      <>
                        {plan.actionLabel}
                        <ArrowRight
                          size={16}
                          className={`ml-2 ${
                            plan.popular
                              ? "transition-transform group-hover:translate-x-1"
                              : ""
                          }`}
                        />
                      </>
                    )}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>

        <div className="mt-16 text-center">
          <p className="text-muted-foreground mb-4">All plans include:</p>
          <div className="flex flex-wrap justify-center gap-4 max-w-3xl mx-auto">
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              TikTok Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Instagram Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Facebook Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Threads Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              YouTube Integration
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Email Support
            </span>
            <span className="inline-flex items-center px-3 py-1 rounded-full bg-primary/5 text-sm">
              <Check size={16} className="mr-1 text-green-500" />
              Security & Compliance
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
