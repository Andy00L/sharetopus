"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

/* Tiles spread around the hero title area, NOT in the center where text lives.
   4 tiles upper-zone (around h1), 4 tiles lower-zone (around CTAs/testimonial).
   `comingSoon: true` => icon blurred + lower opacity. */
const PLATFORMS = [
  /* Upper zone (around the title) */
  { id: "linkedin", src: "/linkedin.svg", x: 4, y: 14, comingSoon: false },
  { id: "tiktok", src: "/tiktok.svg", x: 9, y: 40, comingSoon: false },
  { id: "x", src: "/x.svg", x: 94, y: 12, comingSoon: true },
  { id: "youtube", src: "/youtube.svg", x: 90, y: 36, comingSoon: false },
  /* Lower zone (around CTAs / testimonial) */
  { id: "instagram", src: "/instagram.svg", x: 2, y: 64, comingSoon: true },
  { id: "threads", src: "/threads.svg", x: 10, y: 88, comingSoon: true },
  { id: "pinterest", src: "/pinterest.svg", x: 91, y: 66, comingSoon: false },
  { id: "facebook", src: "/facebook.svg", x: 95, y: 90, comingSoon: true },
];

const REPEL_RADIUS = 200;
const REPEL_STRENGTH = 80;

/* Floating platform tiles behind the hero content. Cursor-repel effect.
   Uses a window listener so the content layer's z-index does not block
   mousemove. Tiles themselves are pointer-events-none so they never
   intercept clicks on CTAs or links above them. */
export function PlatformTilesBg() {
  const ref = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      setSize({ w: rect.width, h: rect.height });
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x >= 0 && y >= 0 && x <= rect.width && y <= rect.height) {
        setCursor({ x, y });
      } else {
        setCursor(null);
      }
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block"
      aria-hidden="true"
    >
      {PLATFORMS.map((p) => {
        let dx = 0;
        let dy = 0;

        if (cursor && size) {
          const tileX = (p.x / 100) * size.w;
          const tileY = (p.y / 100) * size.h;
          const diffX = tileX - cursor.x;
          const diffY = tileY - cursor.y;
          const dist = Math.sqrt(diffX * diffX + diffY * diffY);
          if (dist < REPEL_RADIUS && dist > 0) {
            const force = (REPEL_RADIUS - dist) / REPEL_RADIUS;
            dx = (diffX / dist) * force * REPEL_STRENGTH;
            dy = (diffY / dist) * force * REPEL_STRENGTH;
          }
        }

        return (
          <div
            key={p.id}
            className="absolute flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line-2)] bg-white shadow-[0_8px_24px_-12px_rgba(28,27,24,0.18)] transition-transform duration-500 ease-out"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`,
              opacity: p.comingSoon ? 0.45 : 1,
            }}
          >
            <Image
              src={p.src}
              alt=""
              width={26}
              height={26}
              className="object-contain"
              style={p.comingSoon ? { filter: "blur(2px)" } : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
