import type React from "react";

import type { Platform } from "@/db/schema";

import {
  IconBrandBluesky,
  IconBrandDiscord,
  IconBrandDribbble,
  IconBrandGoogle,
  IconBrandKick,
  IconBrandMastodon,
  IconBrandMedium,
  IconBrandReddit,
  IconBrandSlack,
  IconBrandTelegram,
  IconBrandTumblr,
  IconBrandTwitch,
  IconBrandWordpress,
} from "@tabler/icons-react";

import PinterestSVGIcon, {
  FacebookSVGIcon,
  InstagramSVGIcon,
  LinkedinSVGIcon,
  ThreadsSVGIcon,
  TiktokSVGIcon,
  TwitterVGIcon,
  YoutubeSVGIcon,
} from "./allPlatformsIcons";

const TABLER_BRAND_STROKE = 1.75;

const PLATFORM_BRAND_ICONS: Partial<Record<string, React.JSX.Element>> = {
  linkedin: <LinkedinSVGIcon />,
  pinterest: <PinterestSVGIcon />,
  tiktok: <TiktokSVGIcon />,
  instagram: <InstagramSVGIcon />,
  x: <TwitterVGIcon />,
  youtube: <YoutubeSVGIcon />,
  facebook: <FacebookSVGIcon />,
  threads: <ThreadsSVGIcon />,
  bluesky: <IconBrandBluesky className="size-3" stroke={TABLER_BRAND_STROKE} />,
  mastodon: <IconBrandMastodon className="size-3" stroke={TABLER_BRAND_STROKE} />,
  telegram: <IconBrandTelegram className="size-3" stroke={TABLER_BRAND_STROKE} />,
  discord: <IconBrandDiscord className="size-3" stroke={TABLER_BRAND_STROKE} />,
  slack: <IconBrandSlack className="size-3" stroke={TABLER_BRAND_STROKE} />,
  wordpress: <IconBrandWordpress className="size-3" stroke={TABLER_BRAND_STROKE} />,
  reddit: <IconBrandReddit className="size-3" stroke={TABLER_BRAND_STROKE} />,
  tumblr: <IconBrandTumblr className="size-3" stroke={TABLER_BRAND_STROKE} />,
  twitch: <IconBrandTwitch className="size-3" stroke={TABLER_BRAND_STROKE} />,
  kick: <IconBrandKick className="size-3" stroke={TABLER_BRAND_STROKE} />,
  medium: <IconBrandMedium className="size-3" stroke={TABLER_BRAND_STROKE} />,
  dribbble: <IconBrandDribbble className="size-3" stroke={TABLER_BRAND_STROKE} />,
  gmb: <IconBrandGoogle className="size-3" stroke={TABLER_BRAND_STROKE} />,
  linkedin_page: <LinkedinSVGIcon />,
} satisfies Partial<Record<Platform, React.JSX.Element>>;

export function PlatformBrandIcon({
  platform,
}: {
  readonly platform: string;
}) {
  return (
    PLATFORM_BRAND_ICONS[platform.toLowerCase()] ?? (
      <PlatformLetterBadge platform={platform} />
    )
  );
}

function PlatformLetterBadge({
  platform,
}: {
  readonly platform: string;
}) {
  const initialLetter = platform.charAt(0).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="font-mono text-[9px] font-semibold leading-none"
    >
      {initialLetter}
    </span>
  );
}
