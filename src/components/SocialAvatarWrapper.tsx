// src/components/SocialAvatarWrapper.tsx
"use client";

import AvatarWithFallback from "./AvatarWithFallback";
import PinterestSVGIcon, {
  BlueskySVGIcon,
  FacebookSVGIcon,
  InstagramSVGIcon,
  LinkedinSVGIcon,
  ThreadsSVGIcon,
  TiktokSVGIcon,
  TwitterVGIcon,
  YoutubeSVGIcon,
} from "./icons/allPlatformsIcons";
type SocialPlatform =
  | "linkedin"
  | "pinterest"
  | "tiktok"
  | "instagram"
  | "twitter"
  | "youtube"
  | "facebook"
  | "threads"
  | "bluesky";
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
}
// Map of platform names to their respective icon components
const PLATFORM_ICONS = {
  linkedin: LinkedinSVGIcon,
  pinterest: PinterestSVGIcon,
  tiktok: TiktokSVGIcon,
  instagram: InstagramSVGIcon,
  twitter: TwitterVGIcon,
  youtube: YoutubeSVGIcon,
  facebook: FacebookSVGIcon,
  threads: ThreadsSVGIcon,
  bluesky: BlueskySVGIcon,
};
export default function SocialAvatarWrapper({
  src,
  alt,
  platform,
  className,
  size = 64,
}: SocialAvatarWrapperProps) {
  // Calculate icon size (approximately 1/3 of the avatar size)
  const iconSize = Math.floor(size / 2);

  // Get the appropriate icon component based on platform name
  const IconComponent =
    PLATFORM_ICONS[platform.toLowerCase() as SocialPlatform];

  // If no matching platform is found, return just the avatar without an icon
  if (!IconComponent) {
    return <AvatarWithFallback src={src} alt={alt} size={size} />;
  }

  return (
    <div className="relative inline-flex">
      {/* The avatar image */}
      <AvatarWithFallback
        src={src}
        alt={alt}
        size={size}
        className={className}
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
          <IconComponent />
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
