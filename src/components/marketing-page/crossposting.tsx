"use client";

import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CircuitBoard } from "@/components/ui/circuit-board";
import { User } from "lucide-react";
import { Octopus } from "./icons/octopus";

/* Platform data. Shipped platforms have full integration (OAuth + posting).
   Aspirational platforms exist in the DB enum but have no backend code yet.
   Source: docs/PLATFORMS.md. Icons: public SVGs in /public/. */
const PLATFORMS = [
  { id: "linkedin", label: "LinkedIn", src: "/linkedin.svg", shipped: true },
  { id: "tiktok", label: "TikTok", src: "/tiktok.svg", shipped: true },
  { id: "pinterest", label: "Pinterest", src: "/pinterest.svg", shipped: true },
  { id: "instagram", label: "Instagram", src: "/instagram.svg", shipped: true },
  { id: "x", label: "X", src: "/x.svg", shipped: false },
  { id: "facebook", label: "Facebook", src: "/facebook.svg", shipped: false },
  { id: "youtube", label: "YouTube", src: "/youtube.svg", shipped: false },
  { id: "threads", label: "Threads", src: "/threads.svg", shipped: false },
];

const SHIPPED_COUNT = PLATFORMS.filter((p) => p.shipped).length;

/* CircuitBoard canvas geometry. Fixed pixel viewport.
   User on the left, Sharetopus hub in the center, 8 platforms vertically
   distributed on the right. The wrapper allows horizontal scroll on
   viewports narrower than CANVAS_WIDTH. Canvas is 500px tall to give
   platform nodes enough vertical breathing room (no label overlap). */
const CANVAS_WIDTH = 580;
const CANVAS_HEIGHT = 500;
const USER_X = 30;
const HUB_X = 290;
const PLAT_X = 520;
const CENTER_Y = CANVAS_HEIGHT / 2;
const PLAT_Y_START = 40;
const PLAT_Y_END = CANVAS_HEIGHT - 40;
const PLAT_STEP = (PLAT_Y_END - PLAT_Y_START) / (PLATFORMS.length - 1);

/* Crossposting section. Two-column on desktop, stacked on mobile.
   Left: eyebrow + headline + body + two CTAs.
   Right: animated CircuitBoard showing data flow user -> hub -> platforms.
   On mobile, diagram renders first (order-1) for visual impact. */
export default function Crossposting() {
  /* Build CircuitBoard nodes: 1 user + 1 hub + 8 platforms.
     User and hub get labels. Platform nodes are label-free (the SVG icon
     is self-explanatory and labels caused vertical overlap at this density).
     Platform nodes use size "sm" (24px) for tighter visual weight. */
  const nodes = [
    {
      id: "user",
      x: USER_X,
      y: CENTER_Y,
      label: "You",
      icon: <User className="w-4 h-4" strokeWidth={1.6} />,
    },
    {
      id: "hub",
      x: HUB_X,
      y: CENTER_Y,
      label: "Sharetopus",
      icon: <Octopus size={20} />,
    },
    ...PLATFORMS.map((p, i) => ({
      id: p.id,
      x: PLAT_X,
      y: Math.round(PLAT_Y_START + i * PLAT_STEP),
      status: p.shipped ? ("active" as const) : ("inactive" as const),
      size: "sm" as const,
      icon: (
        <Image
          src={p.src}
          alt={p.label}
          width={14}
          height={14}
          className="object-contain"
        />
      ),
    })),
  ];

  /* Connections: user -> hub first, then hub -> each platform.
     All orange. The CircuitBoard staggers animation start times by index,
     so the user->hub pulse fires first, then hub->platform pulses fan out. */
  const connections = [
    { from: "user", to: "hub", animated: true },
    ...PLATFORMS.map((p) => ({
      from: "hub",
      to: p.id,
      animated: true,
    })),
  ];

  return (
    <section
      id="platforms"
      className="py-16 md:py-24 px-4 md:px-8 max-w-6xl mx-auto"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-10 md:gap-16 items-center">
        {/* Copy and CTAs. */}
        <div className="order-2 md:order-1">
          <div className="t-eyebrow mb-3">
            <span className="inline-block size-1.5 rounded-full bg-primary mr-2 align-middle" />
            Cross-posting
          </div>
          <h2 className="t-section-h2 mb-5">
            Post to all platforms{" "}
            <span className="t-section-accent">instantly.</span>
          </h2>
          <p className="t-body max-w-md mb-7">
            Publish everywhere in 30 seconds, not 30 minutes. Manage personal
            and brand accounts without switching tabs. One composer,{" "}
            {SHIPPED_COUNT} networks (more on the way).
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              asChild
              className="rounded-full bg-primary text-primary-foreground t-button px-6 py-3 hover:bg-[var(--orange-2)]"
            >
              <Link href="/create">
                Start posting <span className="ml-1">→</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="rounded-full t-button px-6 py-3 border-foreground text-foreground hover:bg-foreground hover:text-background"
            >
              <a href="#pricing">View pricing</a>
            </Button>
          </div>
        </div>

        {/* CircuitBoard hub-and-spoke. Fixed pixel canvas.
            The wrapper provides horizontal scroll on phones where
            CANVAS_WIDTH (580px) exceeds viewport width.
            The -mx-4/px-4 trick extends the scroll past the section padding
            so the visual feels edge-to-edge on mobile. */}
        <div
          className="order-1 md:order-2 w-full -mx-4 md:mx-0 px-4 md:px-0 overflow-x-auto md:overflow-visible"
          role="img"
          aria-label="Cross-posting flow: one user, through the Sharetopus hub, out to every social platform"
        >
          <div className="flex justify-center min-w-fit">
            <CircuitBoard
              nodes={nodes}
              connections={connections}
              width={CANVAS_WIDTH}
              height={CANVAS_HEIGHT}
              variant="light"
              traceColor="var(--line)"
              traceWidth={2.5}
              pulseColor="#FF5A36"
              showGrid={false}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
