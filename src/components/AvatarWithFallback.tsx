// src/components/core/accounts/social/AvatarWithFallback.tsx
"use client";

import Image from "next/image";
import { UserCheck } from "lucide-react";
import { useState } from "react";
import clsx from "clsx";

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
  size = 64,
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
    <Image
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={clsx("object-cover", className)}
      onError={() => setErrored(true)}
      /* keep blurDataURL / priority / placeholder if you already used them */
    />
  );
}
