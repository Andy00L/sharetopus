"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

// x and y are percentages of the hero area; tiles stay clear of the centered text.
const PLATFORMS = [
  { id: "linkedin", src: "/linkedin.svg", x: 4, y: 14, comingSoon: false },
  { id: "tiktok", src: "/tiktok.svg", x: 9, y: 40, comingSoon: false },
  { id: "x", src: "/x.svg", x: 94, y: 12, comingSoon: true },
  { id: "youtube", src: "/youtube.svg", x: 90, y: 36, comingSoon: false },
  { id: "instagram", src: "/instagram.svg", x: 2, y: 64, comingSoon: true },
  { id: "threads", src: "/threads.svg", x: 10, y: 88, comingSoon: true },
  { id: "pinterest", src: "/pinterest.svg", x: 91, y: 66, comingSoon: false },
  { id: "facebook", src: "/facebook.svg", x: 95, y: 90, comingSoon: true },
];

const REPEL_RADIUS = 200;
const REPEL_STRENGTH = 80;

/** Platform tiles behind the hero that drift away from the cursor; pointer-events-none so they never block clicks. */
export function PlatformTilesBg() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
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
        setCursor({ x: cursorX, y: cursorY });
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
          const diffX = (platform.x / 100) * size.width - cursor.x;
          const diffY = (platform.y / 100) * size.height - cursor.y;
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
              left: `${platform.x}%`,
              top: `${platform.y}%`,
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
