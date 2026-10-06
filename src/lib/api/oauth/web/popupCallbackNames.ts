import type { PostingPlatform } from "@/lib/platforms/capabilities";

const POPUP_CALLBACK_PREFIXES = {
  tiktok: "TikTok",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  facebook: "Facebook",
} as const satisfies Record<PostingPlatform, string>;

/** window.opener callbacks the connect popup calls; client-safe so the connect button registers the same names. */
export function popupCallbackNames(platform: PostingPlatform) {
  const prefix = POPUP_CALLBACK_PREFIXES[platform];
  return {
    success: `on${prefix}ConnectSuccess`,
    failure: `on${prefix}ConnectFailure`,
  } as const;
}
