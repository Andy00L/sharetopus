"use client";

import Image from "next/image";
import { useCallback, useState } from "react";
import sharetopusLogo from "../../../public/trans_logo (1).webp";
import user4 from "../../../public/userdemo1 .webp";
import user2 from "../../../public/userdemo2.webp";
import user3 from "../../../public/userdemo3.webp";
import user5 from "../../../public/userdemo5.webp";

const USER_TYPES = [
  "entrepreneurs",
  "small business owners",
  "creators",
  "marketers",
  "agencies",
];

const TAGLINE_ROTATION_MS = 3000;

// First avatar on top; arbitrary z-index values because Tailwind ships only z-0 to z-50.
const AVATARS = [
  { src: sharetopusLogo, zIndex: 50 },
  { src: user2, zIndex: 40 },
  { src: user3, zIndex: 30 },
  { src: user4, zIndex: 20 },
  { src: user5, zIndex: 10 },
];

/** Stacked avatars, five stars, and a tagline that rotates every 3 s (paused on hover). */
export function AnimatedTestimonial() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const rotateTaglineWhileUnpaused = useCallback(
    (testimonial: HTMLDivElement | null) => {
      if (!testimonial || isPaused) return;
      const rotationTimer = setInterval(() => {
        setCurrentIndex((previousIndex) => (previousIndex + 1) % USER_TYPES.length);
      }, TAGLINE_ROTATION_MS);
      return () => clearInterval(rotationTimer);
    },
    [isPaused],
  );

  return (
    <div
      ref={rotateTaglineWhileUnpaused}
      className="flex flex-col items-center justify-center sm:flex-row"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="flex -space-x-2 mb-3 sm:mb-0 sm:mr-3">
        {AVATARS.map((avatar) => (
          <Image
            key={avatar.zIndex}
            src={avatar.src}
            alt=""
            width={36}
            height={36}
            className="rounded-full border-[3px] border-[var(--cream)] bg-white"
            style={{ zIndex: avatar.zIndex }}
          />
        ))}
      </div>

      <div className="flex flex-col items-center sm:items-start">
        <div className="flex gap-0.5 mb-1">
          {[...Array(5)].map((_, starIndex) => (
            <svg
              key={starIndex}
              className="w-4 h-4 fill-[var(--orange)]"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
            </svg>
          ))}
        </div>

        <div className="text-sm text-[var(--muted)]">
          <span>Loved by </span>
          <span className="font-semibold text-[var(--ink)]">7447 </span>
          <span
            key={currentIndex}
            className="inline-block animate-in fade-in duration-300"
          >
            {USER_TYPES[currentIndex]}
          </span>
        </div>
      </div>
    </div>
  );
}
