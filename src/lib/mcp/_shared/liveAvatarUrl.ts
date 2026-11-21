const MS_PER_SECOND = 1000;

/** Signed CDN URLs carry their expiry in Unix seconds: TikTok's in x-expires, LinkedIn media.licdn.com's in e. */
function readSignedExpirySeconds(avatarUrl: URL): number | null {
  const tiktokExpiry = avatarUrl.searchParams.get("x-expires");
  if (tiktokExpiry !== null) return Number(tiktokExpiry);
  if (avatarUrl.hostname === "media.licdn.com") {
    const linkedinExpiry = avatarUrl.searchParams.get("e");
    if (linkedinExpiry !== null) return Number(linkedinExpiry);
  }
  return null;
}

export function selectLiveAvatarUrl(
  storedAvatarUrl: string | null,
  nowMs: number,
): string | null {
  if (!storedAvatarUrl) return null;
  if (!URL.canParse(storedAvatarUrl)) return null;
  const expirySeconds = readSignedExpirySeconds(new URL(storedAvatarUrl));
  if (expirySeconds === null) return storedAvatarUrl;
  if (!Number.isFinite(expirySeconds)) return null;
  return expirySeconds * MS_PER_SECOND > nowMs ? storedAvatarUrl : null;
}
