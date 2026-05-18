"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Menu,
  ArrowRight,
  Repeat,
  PenLine,
  LineChart,
  Globe,
  X,
} from "lucide-react";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Octopus } from "../icons/octopus";

/* Features dropdown items. Each one navigates to a section anchor on the
   marketing page. Icons are lucide-react. */
const FEATURES_ITEMS = [
  {
    icon: Repeat,
    title: "Set-and-forget cross-posting",
    desc: "Publish one post to every platform in 30 seconds",
    href: "#platforms",
  },
  {
    icon: PenLine,
    title: "The Composer",
    desc: "One editor with native previews for every network",
    href: "#composer",
  },
  {
    icon: LineChart,
    title: "Smart scheduling",
    desc: "Auto-post at the best time per platform",
    href: "#features",
  },
  {
    icon: Globe,
    title: "9 platforms supported",
    desc: "X, IG, TikTok, LinkedIn, FB, YT, Threads, Pinterest, GBP",
    href: "#platforms",
  },
];

/* Plain nav links (no dropdown). Rendered in the desktop row and
   inside the mobile sheet. */
const NAV_LINKS = [
  { label: "Pricing", href: "#pricing" },
  { label: "Platforms", href: "#platforms" },
  { label: "Reviews", href: "#reviews" },
  /* TODO. Wire docs route when /docs ships. */
  { label: "Docs", href: "#docs" },
];

/* Single Features menu item inside the NavigationMenuContent dropdown.
   Icon container morphs to orange on hover for affordance feedback. */
function FeatureMenuItem({
  icon: Icon,
  title,
  desc,
  href,
}: {
  icon: typeof Repeat;
  title: string;
  desc: string;
  href: string;
}) {
  return (
    <li>
      <NavigationMenuLink asChild>
        <Link
          href={href}
          className="flex items-start gap-3 rounded-xl p-3 hover:bg-[var(--cream)] transition-colors group/feature"
        >
          <span className="flex shrink-0 w-9 h-9 items-center justify-center rounded-lg bg-[var(--cream-2)] text-[var(--ink)] transition-colors group-hover/feature:bg-[var(--orange)] group-hover/feature:text-white">
            <Icon className="w-[18px] h-[18px]" strokeWidth={1.7} />
          </span>
          <span className="flex flex-col gap-[3px] flex-1">
            <span className="font-bold text-[14px] tracking-tight leading-tight text-[var(--ink)]">
              {title}
            </span>
            <span className="text-[12.5px] text-[var(--ink-2)] leading-snug">
              {desc}
            </span>
          </span>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}

/* Sharetopus marketing top nav. Sticky, semi-transparent cream
   backdrop with blur. Brand left, links center, CTAs right.
   Features link opens a dropdown via shadcn NavigationMenu.
   Mobile gets a hamburger that opens a right-side Sheet drawer. */
export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--line)] bg-[rgba(243,244,239,0.85)] backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 md:px-8">
        <div className="flex items-center justify-between py-[18px]">
          {/* Brand: Octopus mark + wordmark. */}
          <Link href="/" className="flex items-center gap-2.5">
            <Octopus size={34} />
            <span className="t-wordmark">Sharetopus</span>
          </Link>

          {/* Desktop nav links. Hidden on mobile. */}
          <div className="hidden md:flex items-center">
            <NavigationMenu>
              <NavigationMenuList className="gap-2">
                {/* Pricing (plain link). */}
                <NavigationMenuItem>
                  <NavigationMenuLink asChild>
                    <Link
                      href="#pricing"
                      className="t-nav-link px-3 py-2 rounded-md text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
                    >
                      Pricing
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>

                {/* Features (dropdown). NavigationMenuTrigger includes
                    a built-in ChevronDown that rotates on open. */}
                <NavigationMenuItem>
                  <NavigationMenuTrigger className="t-nav-link px-3 py-2 text-[var(--ink-2)] hover:text-[var(--ink)] bg-transparent hover:bg-transparent focus:bg-transparent data-[state=open]:bg-transparent shadow-none gap-1">
                    Features
                  </NavigationMenuTrigger>
                  <NavigationMenuContent className="rounded-2xl border border-[var(--line-2)] bg-white shadow-[var(--shadow-soft)] p-2.5">
                    <ul className="w-[360px] flex flex-col gap-0.5">
                      {FEATURES_ITEMS.map((item) => (
                        <FeatureMenuItem
                          key={item.title}
                          icon={item.icon}
                          title={item.title}
                          desc={item.desc}
                          href={item.href}
                        />
                      ))}
                    </ul>
                    {/* View all features footer link. */}
                    <div className="mt-1.5 border-t border-[var(--line-2)]">
                      <NavigationMenuLink asChild>
                        <Link
                          href="#features"
                          className="flex items-center justify-between px-3 py-3 font-bold text-[13px] text-[var(--ink)] hover:text-[var(--orange)] transition-colors"
                        >
                          View all features
                          <ArrowRight className="w-3.5 h-3.5" strokeWidth={2} />
                        </Link>
                      </NavigationMenuLink>
                    </div>
                  </NavigationMenuContent>
                </NavigationMenuItem>

                {/* Platforms, Reviews, Docs (plain links). */}
                {NAV_LINKS.filter((l) => l.label !== "Pricing").map((link) => (
                  <NavigationMenuItem key={link.label}>
                    <NavigationMenuLink asChild>
                      <Link
                        href={link.href}
                        className="t-nav-link px-3 py-2 rounded-md text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
                      >
                        {link.label}
                      </Link>
                    </NavigationMenuLink>
                  </NavigationMenuItem>
                ))}
              </NavigationMenuList>
            </NavigationMenu>
          </div>

          {/* Right-side CTAs + mobile hamburger. */}
          <div className="flex items-center gap-3 md:gap-4">
            {/* Sign in (desktop only, lives in sheet on mobile). */}
            <Link
              href="/sign-in"
              className="hidden md:inline-block t-nav-link text-[var(--ink-2)] hover:text-[var(--ink)] transition-colors"
            >
              Sign in
            </Link>

            {/* Get Started CTA (desktop only). */}
            <Button
              asChild
              className="hidden md:inline-flex rounded-full bg-primary text-primary-foreground t-button px-5 py-3 hover:bg-[var(--orange-2)] gap-1.5"
            >
              <Link href="/sign-up">
                Get Started
                <ArrowRight className="w-3.5 h-3.5" strokeWidth={2.5} />
              </Link>
            </Button>

            {/* Hamburger trigger (mobile only). */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-label="Open menu"
                  className="md:hidden inline-flex items-center justify-center w-9 h-9 rounded-md text-[var(--ink)]"
                >
                  <Menu className="w-5 h-5" strokeWidth={2} />
                </button>
              </SheetTrigger>

              {/* Mobile drawer. Slides in from right. The built-in
                  SheetContent close button is hidden via the selector
                  below; a custom header with brand + close replaces it. */}
              <SheetContent
                side="right"
                className="bg-[var(--cream)] border-l border-[var(--line)] p-0 w-[min(360px,85vw)] [&>button.absolute]:hidden"
              >
                {/* a11y: SheetTitle required by Radix dialog. Visually hidden. */}
                <SheetTitle className="sr-only">Navigation menu</SheetTitle>

                {/* Sheet header: brand + close. */}
                <div className="flex items-center justify-between px-5 py-5 border-b border-[var(--line-2)]">
                  <div className="flex items-center gap-2.5">
                    <Octopus size={28} />
                    <span className="t-wordmark text-[18px]">Sharetopus</span>
                  </div>
                  <SheetClose asChild>
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--ink)]"
                    >
                      <X className="w-5 h-5" strokeWidth={2} />
                    </button>
                  </SheetClose>
                </div>

                {/* Sheet links: plain nav items as tap-friendly rows. */}
                <div className="flex flex-col">
                  {NAV_LINKS.map((link) => (
                    <SheetClose asChild key={link.label}>
                      <Link
                        href={link.href}
                        className="px-5 py-4 text-[16px] font-medium text-[var(--ink)] border-b border-[var(--line-2)] hover:bg-white transition-colors"
                      >
                        {link.label}
                      </Link>
                    </SheetClose>
                  ))}

                  {/* Features items flattened as individual rows (no nested
                      expand on mobile). */}
                  {FEATURES_ITEMS.map((item) => (
                    <SheetClose asChild key={item.title}>
                      <Link
                        href={item.href}
                        className="flex items-start gap-3 px-5 py-3.5 border-b border-[var(--line-2)] hover:bg-white transition-colors"
                      >
                        <span className="flex shrink-0 w-8 h-8 items-center justify-center rounded-md bg-[var(--cream-2)] text-[var(--ink)]">
                          <item.icon className="w-4 h-4" strokeWidth={1.7} />
                        </span>
                        <span className="flex flex-col">
                          <span className="text-[14px] font-bold tracking-tight text-[var(--ink)]">
                            {item.title}
                          </span>
                          <span className="text-[12px] text-[var(--ink-2)] leading-snug">
                            {item.desc}
                          </span>
                        </span>
                      </Link>
                    </SheetClose>
                  ))}
                </div>

                {/* Sheet footer: Sign in + Get Started stacked. */}
                <div className="flex flex-col gap-3 px-5 py-5 mt-auto border-t border-[var(--line-2)]">
                  <SheetClose asChild>
                    <Link
                      href="/sign-in"
                      className="text-[15px] font-medium text-[var(--ink-2)] hover:text-[var(--ink)]"
                    >
                      Sign in
                    </Link>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button
                      asChild
                      className="w-full justify-center rounded-full bg-primary text-primary-foreground t-button-lg py-3 hover:bg-[var(--orange-2)] gap-1.5"
                    >
                      <Link href="/sign-up">
                        Get Started
                        <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
                      </Link>
                    </Button>
                  </SheetClose>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </div>
    </nav>
  );
}
