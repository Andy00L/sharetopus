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
  type Icon as TablerIcon,
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

/**
 * One shared platform-to-brand-icon registry for every schedulable
 * platform (legacy adapters + registry providers). Replaces the local
 * per-component icon maps that only knew the legacy eight.
 *
 * Contract matches allPlatformsIcons.tsx: every entry is a zero-prop
 * component rendering a size-3 currentColor glyph, so consumers size and
 * tint through the surrounding wrapper exactly as before.
 */
export type BrandIconComponent = () => React.JSX.Element;

/** Tabler stroke width used for all outline brand glyphs, one weight. */
const TABLER_BRAND_STROKE = 1.75;

function buildBrandIconFromTabler(GlyphIcon: TablerIcon): BrandIconComponent {
  return function PlatformTablerBrandIcon() {
    return <GlyphIcon className="size-3" stroke={TABLER_BRAND_STROKE} />;
  };
}

/**
 * Keys are DB platform values (Platform in src/db/schema.ts, which covers
 * the registry ids from src/lib/platforms/providers/catalog.ts). Platforms
 * absent here (devto, hashnode, lemmy, farcaster, listmonk, nostr) have no
 * brand glyph in @tabler/icons-react 3.43; they render the letter badge.
 */
const PLATFORM_BRAND_ICONS: Record<string, BrandIconComponent> = {
  linkedin: LinkedinSVGIcon,
  pinterest: PinterestSVGIcon,
  tiktok: TiktokSVGIcon,
  instagram: InstagramSVGIcon,
  x: TwitterVGIcon,
  youtube: YoutubeSVGIcon,
  facebook: FacebookSVGIcon,
  threads: ThreadsSVGIcon,
  bluesky: buildBrandIconFromTabler(IconBrandBluesky),
  mastodon: buildBrandIconFromTabler(IconBrandMastodon),
  telegram: buildBrandIconFromTabler(IconBrandTelegram),
  discord: buildBrandIconFromTabler(IconBrandDiscord),
  slack: buildBrandIconFromTabler(IconBrandSlack),
  wordpress: buildBrandIconFromTabler(IconBrandWordpress),
  reddit: buildBrandIconFromTabler(IconBrandReddit),
  tumblr: buildBrandIconFromTabler(IconBrandTumblr),
  twitch: buildBrandIconFromTabler(IconBrandTwitch),
  kick: buildBrandIconFromTabler(IconBrandKick),
  medium: buildBrandIconFromTabler(IconBrandMedium),
  dribbble: buildBrandIconFromTabler(IconBrandDribbble),
  gmb: buildBrandIconFromTabler(IconBrandGoogle),
  linkedin_page: LinkedinSVGIcon,
};

/** Null means: no brand glyph, render PlatformLetterBadge instead. */
export function getPlatformBrandIcon(
  platform: string,
): BrandIconComponent | null {
  return PLATFORM_BRAND_ICONS[platform.toLowerCase()] ?? null;
}

/**
 * Fallback glyph for platforms without a brand icon: the platform's first
 * letter, monospaced so every badge has the same visual weight.
 */
export function PlatformLetterBadge({
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
