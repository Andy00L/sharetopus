"use client";

import { useAuth } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { AnimatedTestimonial } from "../hero/AnimatedTestimonial";
import { PlatformTilesBg } from "./sections/PlatformTilesBg";

/* Marketing hero (v2). Replaces the original hero in (marketing)/page.tsx.
   The original hero/ folder remains in the repo for fallback.

   Layout:
     Mobile: PlatformFan FIRST (visual leads), then text content.
     Desktop: floating PlatformTilesBg around text content, PlatformFan BELOW.

   CTAs:
     Get Started: hard link to /sign-up.
     Watch demo: placeholder TODO (href="#" preventDefault). */
export default function HeroV2() {
  const { userId } = useAuth();

  return (
    <section className="relative max-w-6xl mx-auto px-4 md:px-8 pt-12 md:pt-16 pb-8 text-center">
      {/* Floating platform tiles behind the content. Desktop only.
          Cursor-repel effect on hover. */}
      <PlatformTilesBg />

      {/* Content layer above the floating tiles. */}
      <div className="relative z-10">
        {/* Eyebrow pill. */}
        <div className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] text-[var(--ink-2)] font-medium border border-[var(--line-2)] bg-white/60">
          <span className="size-1.5 rounded-full bg-primary" />
          5,000+ creators · 100K+ posts published
        </div>

        {/* Display headline. */}
        <h1 className="t-hero-h1 mt-6 mb-4">
          Share once.
          <br />
          Post <span className="t-hero-accent">everywhere.</span>
        </h1>

        {/* Hero subtitle. */}
        <p className="t-hero-sub max-w-2xl mx-auto mb-8">
          The simplest way to post and grow on every platform, without the
          enterprise price tag.
        </p>

        {/* Two CTAs. */}
        <div className="flex flex-wrap gap-3 justify-center mb-7">
          <Button
            asChild
            className="rounded-full bg-primary text-primary-foreground t-button-lg px-7 py-4 hover:bg-[var(--orange-2)] gap-1.5"
          >
            <Link href="/create">
              {userId ? "Get back" : "Get Started"} <span>→</span>
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="rounded-full t-button-lg px-7 py-4 border-foreground text-foreground hover:bg-foreground hover:text-background gap-1.5"
          >
            {/* TODO. Wire to demo video URL or modal handler when available. */}
            <a href="#" onClick={(e) => e.preventDefault()}>
              Watch demo
            </a>
          </Button>
        </div>

        {/* Social proof: animated testimonial (avatars + stars + rotating tagline). */}
        <div className="mt-2 flex justify-center">
          <AnimatedTestimonial />
        </div>
      </div>
    </section>
  );
}
