"use client";

import clsx from "clsx";
import { UserCheck } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

interface Props {
  readonly src?: string | null;
  readonly alt: string;
  readonly className?: string;
  readonly size?: number;
  readonly isSelected?: boolean;
}

export default function AvatarWithFallback({
  src,
  alt,
  className,
  size = 40,
  isSelected = false,
}: Props) {
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
