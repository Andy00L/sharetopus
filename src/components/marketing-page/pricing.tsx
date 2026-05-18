"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useAuth } from "@clerk/nextjs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { type Plan, planPrices } from "@/lib/types/plans";
import { checkOutSession } from "@/actions/server/stripe/checkOutSession";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { createCustomerPortal } from "@/actions/server/stripe/customerPortal";

/* Renders feature text, handling **bold** wrapping used in planPrices.
   Features like "**15 connected social accounts**" get bold styling.
   Plain features render as-is. */
function renderFeature(text: string): React.ReactNode {
  if (text.startsWith("**") && text.endsWith("**")) {
    return <strong>{text.slice(2, -2)}</strong>;
  }
  return text;
}

/* Compute yearly savings percentage for a plan.
   Formula: 1 - (yearlyPrice / (monthlyPrice * 12)).
   Returns a rounded integer (e.g. 40 for ~40%). */
function savingsPct(plan: Plan): number {
  const monthlyTotal = plan.monthlyPrice * 12;
  return Math.round((1 - plan.yearlyPrice / monthlyTotal) * 100);
}

/* Pricing section. Three tiers (Starter, Creator, Pro) with monthly/yearly toggle.
   Creator (popular) gets a "Best deal" pill, ink border, and hard offset shadow.
   All plan data comes from planPrices in plans.ts (single source of truth).
   CTAs go through existing Stripe checkout and portal server actions. */
export default function PricingSection() {
  const [isYearly, setIsYearly] = useState(false);
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const { userId, isLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  /* The SAVE badge displays the featured tier's savings percentage.
     Creator = ~40%. Computed, not hardcoded. */
  const featuredPlan = planPrices.find((p) => p.popular);
  const badgePct = featuredPlan ? savingsPct(featuredPlan) : 40;

  /* CTA handler. Routes through existing Stripe server actions.
     Unauthenticated users go to /create (Clerk redirects to sign-in).
     Already-subscribed users go to the Stripe customer portal.
     New subscribers go to Stripe checkout. */
  const handleSubscribe = async (plan: Plan) => {
    try {
      setLoadingPlan(plan.title);

      if (!isLoaded) return;

      if (!isSignedIn) {
        router.push("/create");
        return;
      }

      const sub = await checkActiveSubscription(userId);
      if (sub.isActive) {
        const portal = await createCustomerPortal();
        if (!portal.success) {
          toast.error(portal.message);
          setLoadingPlan(null);
          return;
        }
        if (portal.data) {
          window.location.href = portal.data;
        }
        return;
      }

      const priceId = isYearly ? plan.priceIdYearly : plan.priceIdMonthly;
      const session = await checkOutSession(priceId);
      if (!session.success) {
        toast.error(session.message);
        setLoadingPlan(null);
        return;
      }
      if (session.data) {
        window.location.href = session.data;
      }
    } catch (error) {
      console.error("[PricingSection] Subscription error:", error);
      toast.error("Unable to process request. Please try again.");
      setLoadingPlan(null);
    }
  };

  return (
    <section
      id="pricing"
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
    >
      {/* Section header: eyebrow, display heading, serif-italic subheading. */}
      <div className="text-center mb-8 md:mb-14">
        <div className="t-eyebrow mb-3">
          <span className="inline-block size-1.5 rounded-full bg-primary mr-2 align-middle" />
          Pricing
        </div>
        <h2 className="t-section-h2">
          Fairly priced.{" "}
          <span className="t-section-accent">On purpose.</span>
        </h2>
        <p className="t-section-sub max-w-xl mx-auto mt-4">
          No enterprise tax. Cancel anytime. Monthly or yearly, your call.
        </p>
      </div>

      {/* Billing toggle: Monthly | Switch | Yearly | SAVE badge. */}
      <div className="flex items-center justify-center gap-3.5">
        <span
          className={cn(
            "text-sm font-semibold cursor-pointer select-none",
            !isYearly ? "text-foreground" : "text-muted-foreground"
          )}
          onClick={() => setIsYearly(false)}
        >
          Monthly
        </span>
        <Switch checked={isYearly} onCheckedChange={setIsYearly} />
        <span
          className={cn(
            "text-sm font-semibold cursor-pointer select-none",
            isYearly ? "text-foreground" : "text-muted-foreground"
          )}
          onClick={() => setIsYearly(true)}
        >
          Yearly
        </span>
        <Badge className="bg-primary text-primary-foreground t-chip px-2.5 py-1 rounded-full border-transparent">
          SAVE {badgePct}%
        </Badge>
      </div>

      {/* Plan cards grid: 1 column mobile, 3 columns desktop. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5 mt-12 items-stretch">
        {planPrices.map((plan) => {
          const featured = !!plan.popular;
          const loading = loadingPlan === plan.title;
          const displayPrice = isYearly
            ? plan.monthlyYearlyprice
            : plan.monthlyPrice;

          return (
            <Card
              key={plan.title}
              className={cn(
                "relative flex flex-col rounded-2xl border p-7 gap-0 shadow-none",
                featured &&
                  "border-2 border-foreground shadow-[var(--shadow-hard)]"
              )}
            >
              {/* "Best deal" pill for the featured (Creator) card. */}
              {featured && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-primary text-primary-foreground px-3.5 py-1 t-chip rounded-full border-transparent">
                  Best deal
                </Badge>
              )}

              {/* Tier name (trim handles trailing space on "Pro "). */}
              <div className="t-pricing-tier">
                {plan.title.trim()}
              </div>

              {/* Short description. */}
              <p className="mt-2 text-sm text-muted-foreground leading-snug min-h-[40px]">
                {plan.description}
              </p>

              {/* Price display: big number + "/month" suffix. */}
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="t-pricing-price">
                  ${displayPrice}
                </span>
                <span className="t-pricing-per">/month</span>
              </div>

              {/* Yearly billed line (visible only when yearly toggle is on).
                  Non-breaking space preserves layout height when hidden. */}
              <div className="mt-1 text-xs text-muted-foreground min-h-[18px]">
                {isYearly
                  ? `$${plan.yearlyPrice}/year billed annually`
                  : "\u00A0"}
              </div>

              {/* Feature list with orange checkmarks. */}
              <ul className="mt-5 mb-6 flex flex-col gap-2.5 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2 text-sm items-start">
                    <Check
                      className="size-4 shrink-0 text-primary mt-0.5"
                      strokeWidth={2.5}
                    />
                    <span>{renderFeature(f)}</span>
                  </li>
                ))}
              </ul>

              {/* CTA button. Featured card gets filled ink style, others get outline. */}
              <Button
                className={cn(
                  "w-full justify-center rounded-full t-button py-3 gap-1.5 group cursor-pointer",
                  featured
                    ? "bg-foreground text-background hover:bg-[var(--ink-2)]"
                    : "bg-transparent text-foreground border border-foreground hover:bg-foreground hover:text-background"
                )}
                onClick={() => handleSubscribe(plan)}
                disabled={loading}
              >
                {loading ? "Loading..." : plan.actionLabel}
                <span className="transition-transform group-hover:translate-x-1">
                  →
                </span>
              </Button>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
