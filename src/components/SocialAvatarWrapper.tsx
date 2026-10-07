"use client";

import AvatarWithFallback from "./AvatarWithFallback";
import { PlatformBrandIcon } from "./icons/platformBrandIcons";

interface SocialAvatarWrapperProps {
  /** Image URL for the avatar */
  readonly src?: string | null;
  /** Alt text for accessibility */
  readonly alt: string;
  /** Social platform name (e.g., "instagram", "linkedin") */
  readonly platform: string;

  readonly className: string;
  /** Width/height in pixels, default 64px */
  readonly size?: number;
  readonly isSelected?: boolean;
}

/** An avatar with the platform badge on its top-left edge; the badge overhangs by 30% of its size. */
export default function SocialAvatarWrapper({
  src,
  alt,
  platform,
  className,
  size = 64,
  isSelected = false,
}: SocialAvatarWrapperProps) {
  // Badge diameter: half the avatar size.
  const iconSize = Math.floor(size / 2);

  return (
    <div className="relative inline-flex">
      {/* The avatar image */}
      <AvatarWithFallback
        src={src}
        alt={alt}
        size={size}
        className={className}
        isSelected={isSelected}
      />
      {/* The social icon overlay */}
      <div
        className="absolute flex items-center justify-center rounded-full bg-background  border-2 border-border"
        style={{
          width: iconSize,
          height: iconSize,
          // Add a small margin to position it perfectly
          transform: "translate(-30%, -30%)",
        }}
      >
        <div
          style={{ width: iconSize * 0.6, height: iconSize * 0.6 }}
          className="flex items-center justify-center text-primary"
        >
          <PlatformBrandIcon platform={platform} />
        </div>
      </div>
    </div>
  );
}
