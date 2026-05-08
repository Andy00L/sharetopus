export const CAPTION_LIMITS = {
  default: 2200,
  twitter: 280,
  facebook: 63206,
  instagram: 2200,
  linkedin: 3000,
  pinterest: 500,
  tiktok: 2200,
} as const;

export type CaptionPlatform = keyof typeof CAPTION_LIMITS;
