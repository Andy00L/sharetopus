"use client";

import Image from "next/image";

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

const REPEL_RADIUS_PX = 200;
const REPEL_STRENGTH_PX = 80;

function buildTileTransform(offsetX: number, offsetY: number): string {
  return `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`;
}

const RESTING_TILE_TRANSFORM = buildTileTransform(0, 0);

// Window mousemove listener: the content layer above would swallow events on the container.
function repelTilesFromCursor(tileLayer: HTMLDivElement | null) {
  if (!tileLayer) return;

  const tiles = PLATFORMS.flatMap((platform) => {
    const tile = tileLayer.querySelector<HTMLDivElement>(
      `[data-platform-tile="${platform.id}"]`,
    );
    return tile ? [{ platform, tile }] : [];
  });
  let pendingFrameId = 0;
  let latestPointer = { clientX: 0, clientY: 0 };
  let isCursorInsideLastFrame = false;

  const applyRepulsion = () => {
    pendingFrameId = 0;
    const layerRect = tileLayer.getBoundingClientRect();
    const cursorX = latestPointer.clientX - layerRect.left;
    const cursorY = latestPointer.clientY - layerRect.top;
    const isCursorInside =
      cursorX >= 0 && cursorY >= 0 && cursorX <= layerRect.width && cursorY <= layerRect.height;
    if (!isCursorInside && !isCursorInsideLastFrame) return;
    isCursorInsideLastFrame = isCursorInside;

    for (const { platform, tile } of tiles) {
      let offsetX = 0;
      let offsetY = 0;
      if (isCursorInside) {
        const diffX = (platform.leftPercent / 100) * layerRect.width - cursorX;
        const diffY = (platform.topPercent / 100) * layerRect.height - cursorY;
        const distance = Math.sqrt(diffX * diffX + diffY * diffY);
        if (distance < REPEL_RADIUS_PX && distance > 0) {
          const force = (REPEL_RADIUS_PX - distance) / REPEL_RADIUS_PX;
          offsetX = (diffX / distance) * force * REPEL_STRENGTH_PX;
          offsetY = (diffY / distance) * force * REPEL_STRENGTH_PX;
        }
      }
      tile.style.transform = buildTileTransform(offsetX, offsetY);
    }
  };

  const handleMove = (event: MouseEvent) => {
    latestPointer = { clientX: event.clientX, clientY: event.clientY };
    if (!pendingFrameId) pendingFrameId = requestAnimationFrame(applyRepulsion);
  };
  window.addEventListener("mousemove", handleMove, { passive: true });

  return () => {
    window.removeEventListener("mousemove", handleMove);
    cancelAnimationFrame(pendingFrameId);
  };
}

/** Platform tiles behind the hero that drift away from the cursor; pointer-events-none so they never block clicks. */
export function PlatformTilesBg() {
  return (
    <div
      ref={repelTilesFromCursor}
      className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block"
      aria-hidden="true"
    >
      {PLATFORMS.map((platform) => (
        <div
          key={platform.id}
          data-platform-tile={platform.id}
          className="absolute flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--line-2)] bg-white shadow-[0_8px_24px_-12px_rgba(28,27,24,0.18)] transition-transform duration-500 ease-out"
          style={{
            left: `${platform.leftPercent}%`,
            top: `${platform.topPercent}%`,
            transform: RESTING_TILE_TRANSFORM,
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
      ))}
    </div>
  );
}
