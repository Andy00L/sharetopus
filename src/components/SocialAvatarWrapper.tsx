// src/components/SocialAvatarWrapper.tsx
"use client";

import AvatarWithFallback from "./AvatarWithFallback";
import {
  getPlatformBrandIcon,
  PlatformLetterBadge,
} from "./icons/platformBrandIcons";

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

export default function SocialAvatarWrapper({
  src,
  alt,
  platform,
  className,
  size = 64,
  isSelected = false,
}: SocialAvatarWrapperProps) {
  // Calculate icon size (approximately 1/3 of the avatar size)
  const iconSize = Math.floor(size / 2);

  // Shared registry covers legacy and registry platforms alike; platforms
  // without a brand glyph fall back to the letter badge so every connected
  // account carries a platform marker.
  const IconComponent = getPlatformBrandIcon(platform);

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
        {/* Instead of cloning and modifying, wrap the icon in a sized container */}
        <div
          style={{ width: iconSize * 0.6, height: iconSize * 0.6 }}
          className="flex items-center justify-center text-primary"
        >
          {IconComponent ? (
            <IconComponent />
          ) : (
            <PlatformLetterBadge platform={platform} />
          )}
        </div>
      </div>
    </div>
  );
}
/**use exemple
 * <SocialAvatarWrapper
        src={account.avatar_url}
        alt="LinkedIn Profile"
        platform={account.platform}
        className="h-10 w-10"
        size={40}
      />
 */
