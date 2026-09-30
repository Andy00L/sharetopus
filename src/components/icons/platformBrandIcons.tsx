import type React from "react";

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

/** Tabler stroke width used for all outline brand glyphs, one weight. */
const TABLER_BRAND_STROKE = 1.75;

/**
 * One shared platform-to-brand-glyph registry for every schedulable
 * platform (legacy adapters + registry providers). Every entry is a
 * prebuilt size-3 currentColor element, so consumers size and tint through
 * the surrounding wrapper; elements rather than components keep the
 * per-platform choice out of render.
 *
 * Keys are DB platform values (Platform in src/db/schema.ts, which covers
 * the registry ids from src/lib/platforms/providers/catalog.ts). Platforms
 * absent here (devto, hashnode, lemmy, farcaster, listmonk, nostr) have no
 * brand glyph in @tabler/icons-react 3.43; they render the letter badge.
 */
const PLATFORM_BRAND_ICONS: Record<string, React.JSX.Element> = {
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
};

/**
 * The platform's brand glyph, or its letter badge when it has none, so
 * every connected account carries a platform marker.
 */
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

/**
 * Fallback glyph for platforms without a brand icon: the platform's first
 * letter, monospaced so every badge has the same visual weight.
 */
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
