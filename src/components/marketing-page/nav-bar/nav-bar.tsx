"use client";

import { Button } from "@/components/ui/button";
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
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  ArrowRight,
  Globe,
  LineChart,
  Menu,
  PenLine,
  Repeat,
  X,
} from "lucide-react";
import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Octopus } from "../icons/octopus";

/* Shared class for every desktop nav link + trigger. Matches the
   ReelFarm reference: 15px medium #545454, fades on hover/focus/open. */
const NAV_LINK_CLASS =
  "inline-flex h-9 items-center justify-center rounded-md bg-transparent px-4 py-2 text-[#545454] font-medium text-[15px] transition-colors hover:bg-transparent hover:opacity-50 focus:bg-transparent focus:opacity-50 focus:outline-none data-[state=open]:bg-transparent data-[state=open]:opacity-50";

/* Features dropdown items. Descriptions kept short to prevent line wrap
   (which makes the dropdown taller than the ReelFarm reference). */
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
  { label: "Platforms", href: "#platforms" },
  { label: "Reviews", href: "#reviews" },
  /* TODO. Wire docs route when /docs ships. */
  { label: "Docs", href: "#docs" },
];

/* One row inside the Features dropdown. Plain icon (no colored wrapper),
   title font-medium, description text-sm muted. Matches ReelFarm. */
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
          className="block select-none rounded-lg p-1 py-3 leading-none no-underline outline-none transition-colors hover:bg-[var(--cream)] focus:bg-[var(--cream)]"
        >
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              <Icon className="h-5 w-5 text-[var(--ink)]" strokeWidth={2} />
            </div>
            <div className="flex flex-col gap-1">
              <div className="text-sm font-medium leading-tight text-[var(--ink)]">
                {title}
              </div>
              <p className="text-sm leading-relaxed text-[#8B8A85]">{desc}</p>
            </div>
          </div>
        </Link>
      </NavigationMenuLink>
    </li>
  );
}

/* Sharetopus marketing top nav. Sticky cream bg, hairline border.
   Layout: brand flex-1 left, nav absolutely centered, CTAs flex-1 right.
   Mobile: brand + hamburger. Hamburger opens a right-side Sheet. */
const GET_STARTED_BUTTON_CLASS =
  "w-full justify-center gap-1.5 rounded-full bg-primary py-3 text-[17px] font-medium text-primary-foreground hover:bg-[var(--orange-2)]";

const DESKTOP_CTA_BUTTON_CLASS =
  "gap-1.5 rounded-full bg-primary px-5 py-3 text-[15px] font-medium tracking-[-0.015em] text-primary-foreground hover:bg-[var(--orange-2)]";

export default function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { userId, isLoaded } = useAuth();
  const isSignedIn = Boolean(userId);

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-[var(--line)] bg-[#F3F4EF] px-4 py-3 md:px-6">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between">
        {/* Brand. flex-1 pushes content toward the edges so the centered nav sits between. */}
        <Link href="/" className="flex items-center gap-2 md:flex-1">
          <Octopus size={28} />
          <span className="text-[18px] font-bold tracking-[-0.04em] text-[var(--ink)]">
            Sharetopus
          </span>
        </Link>

        {/* Desktop nav, absolutely centered. */}
        <div className="absolute left-1/2 hidden -translate-x-1/2 transform md:flex">
          <NavigationMenu>
            <NavigationMenuList className="gap-1">
              <NavigationMenuItem>
                <NavigationMenuLink asChild>
                  <Link href="#pricing" className={NAV_LINK_CLASS}>
                    Pricing
                  </Link>
                </NavigationMenuLink>
              </NavigationMenuItem>

              <NavigationMenuItem>
                <NavigationMenuTrigger className={NAV_LINK_CLASS}>
                  Features
                </NavigationMenuTrigger>
                <NavigationMenuContent>
                  <ul className="grid gap-0 w-[400px]">
                    {" "}
                    {/* removed p-2 */}
                    <div className="flex flex-col">
                      {FEATURES_ITEMS.map((item) => (
                        <FeatureMenuItem key={item.title} {...item} />
                      ))}
                    </div>
                    <div className="border-t border-[#E5E5E5] mt-2 pt-2 px-2">
                      <NavigationMenuLink asChild>
                        <Link
                          href="#features"
                          className="rounded-lg px-2 py-2 text-sm font-medium text-[#545454] transition-colors hover:bg-[var(--cream)] hover:text-[#232323]"
                        >
                          <div className="flex items-center justify-between">
                            <span>View all features</span>
                            <ArrowRight className="h-4 w-4" strokeWidth={2} />
                          </div>
                        </Link>
                      </NavigationMenuLink>
                    </div>
                  </ul>
                </NavigationMenuContent>
              </NavigationMenuItem>

              {NAV_LINKS.filter((l) => l.label !== "Pricing").map((link) => (
                <NavigationMenuItem key={link.label}>
                  <NavigationMenuLink asChild>
                    <Link href={link.href} className={NAV_LINK_CLASS}>
                      {link.label}
                    </Link>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        {/* Right side: CTAs on desktop, hamburger on mobile. */}
        <div className="flex items-center gap-3 md:flex-1 md:justify-end md:gap-4">
          {isLoaded && isSignedIn ? (
            <Button
              asChild
              className={cn("hidden md:inline-flex", DESKTOP_CTA_BUTTON_CLASS)}
            >
              <Link href="/create">
                Hey Friend
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
              </Link>
            </Button>
          ) : isLoaded ? (
            <>
              <Link
                href="/sign-in"
                className="hidden text-[15px] font-medium text-[#545454] transition-opacity hover:opacity-50 md:inline-block"
              >
                Sign in
              </Link>
              <Button
                asChild
                className={cn("hidden md:inline-flex", DESKTOP_CTA_BUTTON_CLASS)}
              >
                <Link href="/sign-up">
                  Get Started
                  <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
                </Link>
              </Button>
            </>
          ) : null}

          {/* Mobile hamburger. */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-label="Open menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--ink)] md:hidden"
              >
                <Menu className="h-5 w-5" strokeWidth={2} />
              </button>
            </SheetTrigger>

            <SheetContent
              side="right"
              className="flex h-full w-[min(360px,85vw)] flex-col border-l border-[var(--line)] bg-[var(--cream)] p-0 [&>button.absolute]:hidden"
            >
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>

              <div className="flex items-center justify-between border-b border-[var(--line-2)] px-5 py-5">
                <div className="flex items-center gap-2.5">
                  <Octopus size={28} />
                  <span className="text-[18px] font-bold tracking-[-0.04em] text-[var(--ink)]">
                    Sharetopus
                  </span>
                </div>
                <SheetClose asChild>
                  <button
                    type="button"
                    aria-label="Close menu"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--ink)]"
                  >
                    <X className="h-5 w-5" strokeWidth={2} />
                  </button>
                </SheetClose>
              </div>

              <div className="flex flex-col">
                {NAV_LINKS.map((link) => (
                  <SheetClose asChild key={link.label}>
                    <Link
                      href={link.href}
                      className="border-b border-[var(--line-2)] px-5 py-4 text-[16px] font-medium text-[var(--ink)] transition-colors hover:bg-white"
                    >
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}

                {FEATURES_ITEMS.map((item) => (
                  <SheetClose asChild key={item.title}>
                    <Link
                      href={item.href}
                      className="flex items-center gap-4 border-b border-[var(--line-2)] px-5 py-3.5 transition-colors hover:bg-white"
                    >
                      <div className="flex-shrink-0">
                        <item.icon
                          className="h-5 w-5 text-[var(--ink)]"
                          strokeWidth={2}
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <div className="text-sm font-medium leading-tight text-[var(--ink)]">
                          {item.title}
                        </div>
                        <p className="text-sm leading-relaxed text-[#8B8A85]">
                          {item.desc}
                        </p>
                      </div>
                    </Link>
                  </SheetClose>
                ))}
              </div>

              <div className="mt-auto border-t border-[var(--line-2)] px-5 py-5">
                <SheetClose asChild>
                  <Link
                    href={isSignedIn ? "/create" : "/sign-up"}
                    className={cn("inline-flex", GET_STARTED_BUTTON_CLASS)}
                  >
                    Hey Friend
                    <ArrowRight className="h-4 w-4" strokeWidth={2.5} />
                  </Link>
                </SheetClose>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </nav>
  );
}
