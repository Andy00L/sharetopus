"use client";

import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { EyeTracking } from "./ui/eye-tracking";

/* No-subscription prompt. White card on a cream-leaning page bg, nested
   perks panel, eyes that track the cursor and dilate toward the subscribe
   button (via dilationTargetRef), pulsing orange dot top-right.

   Used on /create, /scheduled, and other gated routes when the user has
   no active subscription. */
export function SubscriptionPrompt() {
  const subscribeButtonRef = useRef<HTMLDivElement>(null);

  return (
    <article className="relative mx-auto mt-6 flex w-full max-w-[580px] flex-col gap-7 rounded-[22px] border border-[#E6E0D0] bg-white p-9 pb-8 text-[#1A1815] antialiased shadow-[0_1px_0_rgba(255,255,255,0.7)_inset,0_1px_2px_rgba(26,24,21,0.04),0_20px_44px_-24px_rgba(26,24,21,0.18)] animate-in fade-in-50 duration-500">
      {/* Pulsing brand-orange status dot, top-right. */}
      <span
        aria-hidden="true"
        className="absolute right-[22px] top-[22px] h-[9px] w-[9px] rounded-full bg-[#FF5A36] shadow-[0_0_0_4px_rgba(255,90,54,0.16)]"
      />

      {/* Header. */}
      <header className="flex flex-col gap-2.5">
        <h2 className="m-0 text-balance text-[30px] font-bold leading-[1.1] tracking-[-0.025em] text-[#1A1815]">
          No active subscription
        </h2>
        <p className="m-0 max-w-[44ch] text-[15px] leading-[1.55] text-[#4A4640]">
          You need to subscribe to create and schedule posts.
        </p>
      </header>

      {/* Nested perks panel. Inner cream bg, soft top highlight. */}
      <section className="relative flex flex-col gap-[18px] overflow-hidden rounded-2xl border border-[#EDE7D6] bg-[#F8F5EC] p-[22px]">
        {/* Subtle top sheen. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.45)_0%,rgba(255,255,255,0)_60%)]"
        />

        <div className="relative text-base font-bold tracking-[-0.01em] text-[#1A1815]">
          Subscribe to...
        </div>

        {[
          {
            title: "Create and schedule unlimited posts",
            sub: "Never worry about content limits again.",
          },
          {
            title: "Connect multiple social accounts",
            sub: "Manage all your platforms in one place.",
          },
          {
            title: "Access all premium features",
            sub: "Increased storage/upload, post speed and priority support.",
          },
        ].map((perk) => (
          <div key={perk.title} className="relative flex items-start gap-3.5">
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#E0F0E6] text-[#2F8F5A] shadow-[inset_0_0_0_1px_rgba(47,143,90,0.16)]"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3.4} />
            </span>
            <div className="flex flex-col gap-0.5">
              <span className="text-[14.5px] font-semibold leading-tight text-[#1A1815]">
                {perk.title}
              </span>
              <span className="text-[13px] leading-[1.45] text-[#8E887B]">
                {perk.sub}
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* Eyes. Track the cursor + dilate toward the subscribe button via ref. */}
      <div className="relative flex items-center justify-center py-1">
        {/* Soft orange glow behind the eyes. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-x-8 -inset-y-4 -z-0 rounded-full bg-[radial-gradient(closest-side,rgba(255,90,54,0.10),rgba(255,90,54,0)_70%)]"
        />
        <EyeTracking
          variant="cartoon"
          eyeSize={75}
          gap={15}
          irisColor="#6B3A1F"
          irisColorSecondary="#D4A574"
          blinkInterval={3000}
          showIrisDetail={true}
          showEyelids={true}
          dilationTargetRef={subscribeButtonRef}
          pupilRange={0.9}
          reactivePupil={true}
        />
      </div>

      {/* Actions. */}
      <div className="flex flex-wrap items-center gap-[18px]">
        <div ref={subscribeButtonRef} className="w-full sm:w-auto">
          <Button
            asChild
            size="lg"
            className="w-full gap-2.5 rounded-xl bg-[#1A1815] px-[22px] py-[13px] text-[14.5px] font-semibold text-white shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_2px_4px_rgba(0,0,0,0.1),0_8px_18px_-10px_rgba(26,24,21,0.55)] transition-all hover:-translate-y-px hover:bg-[#2a2826] hover:shadow-[0_1px_0_rgba(255,255,255,0.08)_inset,0_2px_4px_rgba(0,0,0,0.1),0_14px_24px_-10px_rgba(26,24,21,0.6)] active:translate-y-0 sm:w-auto"
          >
            <Link href="/#pricing">Subscribe now</Link>
          </Button>
        </div>

        <Link
          href="/#pricing"
          className="group relative text-sm font-medium text-[#4A4640] transition-colors hover:text-[#1A1815]"
        >
          View pricing details →
          <span
            aria-hidden="true"
            className="absolute -bottom-[3px] left-0 right-0 h-px bg-[#EDE7D6] transition-colors group-hover:bg-[#1A1815]"
          />
        </Link>
      </div>
    </article>
  );
}
