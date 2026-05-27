"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@clerk/nextjs";
import {
  ArrowRight,
  Globe,
  LineChart,
  Menu,
  PenLine,
  Repeat,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

const NAV_LINK_CLASS =
  "inline-flex h-9 items-center justify-center rounded-md bg-transparent px-4 py-2 text-[#545454] font-medium text-[15px] transition-colors hover:opacity-50 focus:opacity-50 focus:outline-none";

const FEATURES_ITEMS = [
  {
    icon: Repeat,
    title: "Set-and-forget cross-posting",
    desc: "One post to every platform in 30s",
    href: "#platforms",
  },
  {
    icon: PenLine,
    title: "The Composer",
    desc: "Native previews for every network",
    href: "#composer",
  },
  {
    icon: LineChart,
    title: "Smart scheduling",
    desc: "Auto-post at the best time",
    href: "#features",
  },
  {
    icon: Globe,
    title: "9 platforms supported",
    desc: "X, IG, TikTok, LinkedIn + more",
    href: "#platforms",
  },
];

const NAV_LINKS = [
  { label: "Pricing", href: "#pricing" },
  { label: "Features", href: "#features" },
  { label: "Platforms", href: "#platforms" },
  { label: "FAQ", href: "#faq" },
];

const CTA_BUTTON_CLASS =
  "gap-1.5 rounded-full bg-[#FF5A36] px-5 py-3 text-[15px] font-medium tracking-[-0.015em] text-white hover:bg-[#E84A26]";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { userId, isLoaded } = useAuth();
  const isSignedIn = Boolean(userId);

  return (
    <nav className="sticky top-0 z-[100] w-full border-b border-[#D6D5CF] bg-[#F3F4EF] px-4 py-3 md:px-6">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-2 md:flex-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/trans_logo%20(1).webp"
            alt="Sharetopus"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
          />
          <span className="text-[18px] font-bold tracking-[-0.04em] text-[#1C1B18]">
            Sharetopus
          </span>
        </Link>

        {/* Desktop nav, centered */}
        <div className="absolute left-1/2 hidden -translate-x-1/2 transform items-center md:flex">
          {NAV_LINKS.map((link) => (
            <Link key={link.label} href={link.href} className={NAV_LINK_CLASS}>
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3 md:flex-1 md:justify-end md:gap-4">
          {isLoaded && isSignedIn ? (
            <Button
              asChild
              className={cn("hidden md:inline-flex", CTA_BUTTON_CLASS)}
            >
              <Link href="/create">
                Hey Friend
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </Link>
            </Button>
          ) : isLoaded ? (
            <>
              <Link
                href="/create"
                className="hidden text-[15px] font-medium text-[#545454] transition-opacity hover:opacity-50 md:inline-block"
              >
                Sign in
              </Link>
              <Button
                asChild
                className={cn("hidden md:inline-flex", CTA_BUTTON_CLASS)}
              >
                <Link href="/create">
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </Link>
              </Button>
            </>
          ) : null}

          {/* Hamburger */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#1C1B18] md:hidden"
          >
            <Menu className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
      </div>

      {/* Mobile full-screen menu. Opaque, full-screen, not Radix. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[200] flex flex-col bg-[#F3F4EF] md:hidden">
          <div className="flex items-center justify-between border-b border-[#D6D5CF] px-4 py-3">
            <Link
              href="/"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/trans_logo%20(1).webp"
                alt="Sharetopus"
                width={28}
                height={28}
                className="h-7 w-7 object-contain"
              />
              <span className="text-[18px] font-bold tracking-[-0.04em] text-[#1C1B18]">
                Sharetopus
              </span>
            </Link>
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#1C1B18]"
            >
              <X className="h-6 w-6" strokeWidth={2} />
            </button>
          </div>

          <div className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
            <div className="flex flex-col gap-1">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className="rounded-lg px-3 py-3.5 text-[17px] font-semibold text-[#1C1B18] transition-colors hover:bg-[#E9EAE4]"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="border-t border-[#E0E1DB] px-4 py-5">
            {!isSignedIn && (
              <Link
                href="/create"
                onClick={() => setMobileOpen(false)}
                className="mb-3 block w-full rounded-full border border-[#D6D5CF] py-3 text-center text-[16px] font-medium text-[#1C1B18]"
              >
                Sign in
              </Link>
            )}
            <Link
              href={isSignedIn ? "/create" : "/create"}
              onClick={() => setMobileOpen(false)}
              className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#FF5A36] py-3 text-[16px] font-medium text-white hover:bg-[#E84A26]"
            >
              {isSignedIn ? "Hey Friend" : "Get Started"}
              <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
