"use client";

import AvatarWithFallback from "./AvatarWithFallback";
import { PlatformBrandIcon } from "./icons/platformBrandIcons";

const BADGE_OVERHANG_TRANSFORM = "translate(-30%, -30%)";

interface SocialAvatarWrapperProps {
  readonly src?: string | null;
  readonly alt: string;
  readonly platform: string;
  readonly className: string;
  readonly size?: number;
  readonly isSelected?: boolean;
}

export default function SocialAvatarWrapper({
  src,
  alt,
  platform,
  className,
  size = 64,
  isSelected = false,
}: SocialAvatarWrapperProps) {
  const badgeSize = Math.floor(size / 2);
  const iconSize = badgeSize * 0.6;

  return (
    <div className="relative inline-flex">
      <AvatarWithFallback
        src={src}
        alt={alt}
        size={size}
        className={className}
        isSelected={isSelected}
      />
      <div
        className="absolute flex items-center justify-center rounded-full bg-background  border-2 border-border"
        style={{
          width: badgeSize,
          height: badgeSize,
          transform: BADGE_OVERHANG_TRANSFORM,
        }}
      >
        <div
          style={{ width: iconSize, height: iconSize }}
          className="flex items-center justify-center text-primary"
        >
          <PlatformBrandIcon platform={platform} />
        </div>
      </div>
    </div>
  );
}
