"use client";

import { PlatformCard_TikTok } from "./cards/PlatformCard_TikTok";
import { PlatformCard_Instagram } from "./cards/PlatformCard_Instagram";
import { PlatformCard_X } from "./cards/PlatformCard_X";
import { PlatformCard_LinkedIn } from "./cards/PlatformCard_LinkedIn";
import { PlatformCard_YouTube } from "./cards/PlatformCard_YouTube";

/* PlatformFan: 5 mockup cards on desktop, 4 on mobile, in a slight fanned arc.
   Each card is rotated by a fixed angle and pushed down by an arc-relative
   marginTop so the center card sits highest and the outer cards descend.
   transformOrigin is bottom center so the rotation pivots from the base.

   Desktop order: TikTok, Instagram, X, LinkedIn, YouTube
   Mobile order:  TikTok, Instagram, X, YouTube (LinkedIn dropped to fit)

   Client component: rendering choice between mobile and desktop variants
   is driven by the parent's Tailwind responsive classes (md:hidden /
   hidden md:block), not by JS media queries. */
export interface PlatformFanProps {
  mobile?: boolean;
}

export function PlatformFan({ mobile = false }: PlatformFanProps) {
  const desktopCards = [
    PlatformCard_TikTok,
    PlatformCard_Instagram,
    PlatformCard_X,
    PlatformCard_LinkedIn,
    PlatformCard_YouTube,
  ];
  const mobileCards = [
    PlatformCard_TikTok,
    PlatformCard_Instagram,
    PlatformCard_X,
    PlatformCard_YouTube,
  ];
  const cards = mobile ? mobileCards : desktopCards;
  const rotations = mobile ? [-10, -3, 4, 11] : [-14, -7, 0, 7, 14];
  const center = mobile ? 1.5 : 2;
  const arcUnit = mobile ? 16 : 24;

  return (
    <div
      className={
        mobile
          ? "flex gap-2.5 justify-center items-start pt-7 h-[260px]"
          : "flex gap-3.5 justify-center items-start pt-7"
      }
    >
      {cards.map((Card, i) => {
        const arc = Math.abs(i - center) * arcUnit;
        const wrapperStyle: React.CSSProperties = {
          transform: `rotate(${rotations[i]}deg)`,
          marginTop: arc,
          transformOrigin: "center bottom",
        };
        /* Mobile: scale wrapper down to ~110/200 = 55%. */
        return (
          <div
            key={i}
            style={wrapperStyle}
            className={mobile ? "scale-[0.55] origin-bottom" : ""}
          >
            <Card />
          </div>
        );
      })}
    </div>
  );
}
