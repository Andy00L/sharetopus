export const PLATFORM_API_TIMEOUT_MS = 15_000;

export const PLATFORM_PUBLISH_TIMEOUT_MS = 30_000;

// Pinterest (image_url pin) and Instagram (image container) download the image
// from our URL before they answer, and neither states a time limit. Instagram
// caps images at 8 MB and answers subcode 2207003 when its own download is too slow:
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media
// https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/error-codes
export const PLATFORM_IMAGE_PULL_TIMEOUT_MS = 45_000;

// Inngest runs a function step for at most 300 s on Vercel, so one upload stays well under it.
export const PLATFORM_MEDIA_UPLOAD_TIMEOUT_MS = 240_000;
