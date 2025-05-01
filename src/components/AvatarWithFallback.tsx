// src/components/core/accounts/social/AvatarWithFallback.tsx
"use client";

import clsx from "clsx";
import { UserCheck } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface Props {
  /** Image URL (may be undefined or empty). */
  readonly src?: string | null;
  /** Alt text for accessibility. */
  readonly alt: string;
  /** Optional Tailwind classes applied to BOTH img & icon. */
  readonly className?: string;
  /** Width / height — defaults to 64 × 64 (px) like your design. */
  readonly size?: number;
}

export default function AvatarWithFallback({
  src,
  alt,
  className,
  size = 40,
}: Props) {
  const [errored, setErrored] = useState(false);

  /* ---------- show icon if: no src OR already failed ---------- */
  if (!src || errored) {
    return (
      <UserCheck
        aria-label={alt}
        className={clsx("text-muted-foreground", className)}
        width={size}
        height={size}
      />
    );
  }

  /* ---------- otherwise show the real avatar ---------- */
  return (
    <div
      className={clsx(
        "  rounded-full overflow-hidden  bg-muted flex items-center justify-center flex-shrink-0 border-2 border-border",
        className
      )}
    >
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        className={clsx("object-cover ", className)}
        onError={() => setErrored(true)}
      />
    </div>
  );
}
