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
  /** Width / height in px. */
  readonly size?: number;
  readonly isSelected?: boolean;
}

/**
 * A round avatar that falls back to a person icon when the URL is missing or fails (expired
 * TikTok links answer 403). Unoptimized on purpose: avatars come from many CDNs, and one
 * direct URL stays cached across every size the app renders it at.
 */
export default function AvatarWithFallback({
  src,
  alt,
  className,
  size = 40,
  isSelected = false,
}: Props) {
  // Remembering the failed URL, not a flag, lets the next account's src render without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const frameClassName = clsx(
    "rounded-full overflow-hidden bg-muted flex items-center justify-center flex-shrink-0",
    isSelected ? "border-2 border-green-500" : "border-2 border-border",
    className,
  );

  if (!src || failedSrc === src) {
    return (
      <div className={frameClassName}>
        <UserCheck
          aria-label={alt}
          className={clsx("text-muted-foreground", className)}
          width={size}
          height={size}
        />
      </div>
    );
  }

  return (
    <div className={frameClassName}>
      <Image
        src={src}
        alt={alt}
        width={size}
        height={size}
        unoptimized
        className={clsx("object-cover", className)}
        onError={() => setFailedSrc(src)}
      />
    </div>
  );
}
