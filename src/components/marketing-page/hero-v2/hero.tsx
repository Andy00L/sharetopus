"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PlatformFan } from "./sections/PlatformFan";
import { AVATAR_GRADIENTS } from "./state/avatarGradients";

/* Marketing hero (v2). Replaces the original hero in (marketing)/page.tsx.
   The original hero/ folder remains in the repo for fallback.

   Layout:
     Mobile: PlatformFan FIRST (visual leads), then text content.
     Desktop: text content first, then PlatformFan BELOW.

   CTAs:
     Get Started: hard link to /sign-up.
     Watch demo: placeholder TODO (href="#" with preventDefault to avoid
                  jumping to top of page). Replace when demo URL or modal
                  handler is ready.

   Social proof: verbatim from Drew's prototype. Numbers may be aspirational;
   Drew is aware. */
export default function HeroV2() {
  return (
    <section className="px-4 md:px-8 max-w-6xl mx-auto pt-12 md:pt-16 pb-8 text-center">
      {/* Mobile-only fan above text. */}
      <div className="md:hidden mb-4 overflow-hidden">
        <PlatformFan mobile />
      </div>

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
          <Link href="/sign-up">
            Get Started <span>→</span>
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

      {/* Social proof: 5 overlapping avatars + 5 stars + tagline. */}
      <div className="inline-flex items-center gap-3.5 text-[14px] text-[var(--muted)]">
        <div className="flex">
          {AVATAR_GRADIENTS.map((g, i) => (
            <div
              key={i}
              className="w-8 h-8 rounded-full border-2"
              style={{
                background: g,
                borderColor: "var(--cream)",
                marginLeft: i === 0 ? 0 : -10,
              }}
            />
          ))}
        </div>
        <span className="t-stars">★★★★★</span>
        <span>Loved by 5,000+ creators</span>
      </div>

      {/* Desktop-only fan below text. */}
      <div className="hidden md:block mt-12 overflow-hidden">
        <PlatformFan />
      </div>
    </section>
  );
}
