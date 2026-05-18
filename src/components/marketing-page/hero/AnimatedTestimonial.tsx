"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import user1 from "../../../../public/logo_256x256.ico";
import user4 from "../../../../public/userdemo1 .webp";
import user2 from "../../../../public/userdemo2.webp";
import user3 from "../../../../public/userdemo3.webp";
import user5 from "../../../../public/userdemo5.webp";

/* Social-proof row with 5 overlapping avatars, 5 stars (brand orange),
   and a rotating tagline ("Loved by 7447 entrepreneurs", etc.).
   Pauses cycling on hover for accessibility (user can read each one). */
export function AnimatedTestimonial() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const userTypes = [
    "entrepreneurs",
    "small business owners",
    "creators",
    "marketers",
    "agencies",
  ];

  /* Cycle every 3 seconds when not hovered. */
  useEffect(() => {
    if (paused) return;
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % userTypes.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [paused, userTypes.length]);

  /* Avatar list with explicit z-index ordering (arbitrary values because
     Tailwind's z-{N} only ships 0/10/20/30/40/50 by default).
     The first avatar sits on top of the stack, last sits behind. */
  const avatars = [
    { src: user1, z: 50 },
    { src: user2, z: 40 },
    { src: user3, z: 30 },
    { src: user4, z: 20 },
    { src: user5, z: 10 },
  ];

  return (
    <div
      className="flex flex-col items-center justify-center sm:flex-row"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Overlapping avatars. -space-x-2 + 3px white border gives the
          typical stacked-avatar look. */}
      <div className="flex -space-x-2 mb-3 sm:mb-0 sm:mr-3">
        {avatars.map((a, i) => (
          <Image
            key={i}
            src={a.src}
            alt=""
            width={36}
            height={36}
            className="rounded-full border-[3px] border-[var(--cream)]"
            style={{ zIndex: a.z }}
          />
        ))}
      </div>

      <div className="flex flex-col items-center sm:items-start">
        {/* 5 brand-orange stars. */}
        <div className="flex gap-0.5 mb-1">
          {[...Array(5)].map((_, i) => (
            <svg
              key={i}
              className="w-4 h-4 fill-[var(--orange)]"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
            </svg>
          ))}
        </div>

        {/* Tagline with rotating user-type. Fade transition smooths the swap. */}
        <div className="text-sm text-[var(--muted)]">
          <span>Loved by </span>
          <span className="font-semibold text-[var(--ink)]">7447 </span>
          <span
            key={currentIndex}
            className="inline-block animate-in fade-in duration-300"
          >
            {userTypes[currentIndex]}
          </span>
        </div>
      </div>
    </div>
  );
}
