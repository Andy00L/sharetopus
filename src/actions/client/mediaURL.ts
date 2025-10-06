// app/lib/mediaURL.ts
import { createHmac, randomBytes } from "crypto";
import "server-only";

/**
 * Create a short-lived, HMAC-signed URL to your media proxy.
 * The Edge route will verify and stream the bytes to TikTok.
 */
export function createSecureMediaUrlSigned(
  filePath: string, // e.g. "user-videos/video-123.mp4" (bucket/object)
  userId: string, // your authenticated user id
  expiresInSec = 1800 // 30 minutes default
): string {
  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://sharetopus.com/api/media"
      : "http://localhost:3000/api/media";

  const secret = process.env.MEDIA_URL_SECRET;
  if (!secret) throw new Error("MEDIA_URL_SECRET is not set");

  const now = Math.floor(Date.now() / 1000);
  const exp = now + expiresInSec;
  const nonce = randomBytes(8).toString("hex");

  // IMPORTANT: fixed param order + URL-encode before signing
  const payload = `f=${encodeURIComponent(filePath)}&u=${encodeURIComponent(
    userId
  )}&exp=${exp}&n=${nonce}`;

  const sig = createHmac("sha256", secret).update(payload).digest("base64url");

  return `${baseUrl}?${payload}&sig=${sig}`;
}
