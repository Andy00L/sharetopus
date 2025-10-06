// app/lib/mediaURL.ts
import "server-only";

/**
 * Create a short-lived, HMAC-signed URL to your media proxy.
 * The Edge route will verify and stream the bytes to TikTok.
 */
export function createSecureMediaUrlSigned(
  filePath: string, // e.g. "user-videos/video-123.mp4" (bucket/object)
  userId: string // your authenticated user id
): string {
  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://sharetopus.com/api/media"
      : "http://localhost:3000/api/media";

  const params = new URLSearchParams({ file: filePath, user: userId });

  return `${baseUrl}?${params}`;
}
