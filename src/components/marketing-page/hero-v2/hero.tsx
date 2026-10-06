"use client";

import { Button } from "@/components/ui/button";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { AnimatedTestimonial } from "../AnimatedTestimonial";
import { PlatformTilesBg } from "./sections/PlatformTilesBg";

/** Landing hero: headline, CTA and social proof over the floating platform tiles. */
export default function HeroV2() {
  const { userId } = useAuth();

  return (
    <section className="relative max-w-6xl mx-auto px-4 md:px-8 pt-12 md:pt-16 pb-8 text-center">
      <PlatformTilesBg />

      <div className="relative z-10">
        <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] text-[var(--ink-2)] font-medium border border-[var(--line-2)] bg-white/60">
          <span className="size-1.5 rounded-full bg-primary" />
          5,000+ creators · 100K+ posts published
        </div>

        <h1 className="t-hero-h1 mt-6 mb-4">
          Share once.
          <br />
          Post <span className="t-hero-accent">everywhere.</span>
        </h1>

        <p className="t-hero-sub max-w-2xl mx-auto mb-8">
          The simplest way to post and grow on every platform, without the
          enterprise price tag.
        </p>

        <div className="flex flex-wrap gap-3 justify-center mb-7">
          <Button
            asChild
            className="rounded-full bg-primary text-primary-foreground t-button-lg px-7 py-4 hover:bg-[var(--orange-2)] gap-1.5"
          >
            <Link href="/create">
              {userId ? "Get back" : "Get Started"} <span>→</span>
            </Link>
          </Button>
        </div>

        <div className="mt-2 flex justify-center">
          <AnimatedTestimonial />
        </div>
      </div>
    </section>
  );
}
