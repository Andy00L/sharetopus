"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// Tile centers as percentages of the hero area, clear of the centered text.
const PLATFORMS = [
  { id: "linkedin", src: "/linkedin.svg", leftPercent: 4, topPercent: 14, comingSoon: false },
  { id: "tiktok", src: "/tiktok.svg", leftPercent: 9, topPercent: 40, comingSoon: false },
  { id: "x", src: "/x.svg", leftPercent: 94, topPercent: 12, comingSoon: true },
  { id: "youtube", src: "/youtube.svg", leftPercent: 90, topPercent: 36, comingSoon: false },
  { id: "instagram", src: "/instagram.svg", leftPercent: 2, topPercent: 64, comingSoon: true },
  { id: "threads", src: "/threads.svg", leftPercent: 10, topPercent: 88, comingSoon: true },
  { id: "pinterest", src: "/pinterest.svg", leftPercent: 91, topPercent: 66, comingSoon: false },
  { id: "facebook", src: "/facebook.svg", leftPercent: 95, topPercent: 90, comingSoon: true },
];

const REPEL_RADIUS = 200;
const REPEL_STRENGTH = 80;

/** Platform tiles behind the hero that drift away from the cursor; pointer-events-none so they never block clicks. */
export function PlatformTilesBg() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  // Window mousemove listener: the content layer above would swallow events on the container.
  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSize({ width: rect.width, height: rect.height });
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      if (cursorX >= 0 && cursorY >= 0 && cursorX <= rect.width && cursorY <= rect.height) {
        setCursor({ left: cursorX, top: cursorY });
      } else {
        setCursor(null);
      }
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block"
      aria-hidden="true"
    >
      {PLATFORMS.map((platform) => {
        let offsetX = 0;
        let offsetY = 0;

        if (cursor && size) {
          const diffX = (platform.leftPercent / 100) * size.width - cursor.left;
          const diffY = (platform.topPercent / 100) * size.height - cursor.top;
          const distance = Math.sqrt(diffX * diffX + diffY * diffY);
          if (distance < REPEL_RADIUS && distance > 0) {
            const force = (REPEL_RADIUS - distance) / REPEL_RADIUS;
            offsetX = (diffX / distance) * force * REPEL_STRENGTH;
            offsetY = (diffY / distance) * force * REPEL_STRENGTH;
          }
        }

        return (
          <div
            key={platform.id}
            className="absolute flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line-2)] bg-white shadow-[0_8px_24px_-12px_rgba(28,27,24,0.18)] transition-transform duration-500 ease-out"
            style={{
              left: `${platform.leftPercent}%`,
              top: `${platform.topPercent}%`,
              transform: `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`,
              opacity: platform.comingSoon ? 0.45 : 1,
            }}
          >
            <Image
              src={platform.src}
              alt=""
              width={26}
              height={26}
              className="object-contain"
              style={platform.comingSoon ? { filter: "blur(2px)" } : undefined}
            />
          </div>
        );
      })}
    </div>
  );
}
