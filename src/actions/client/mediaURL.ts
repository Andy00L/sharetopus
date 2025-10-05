import "server-only";

/**
 * Creates a secure media URL for TikTok using your Cloudflare Worker
 * @param filePath - The file path in Supabase storage (e.g., "user-videos/video-123.mp4")
 * @param userId - The authenticated user ID
 * @returns Secure URL that TikTok can fetch from
 */
export function createSecureMediaUrl(filePath: string, userId: string): string {
  const baseUrl =
    process.env.NODE_ENV === "production"
      ? "https://media.sharetopus.com"
      : "https://sharetopus-media-worker.sharetopus.workers.dev"; // Replace with your dev worker URL

  const params = new URLSearchParams({
    file: filePath,
    user: userId,
  });

  return `${baseUrl}?${params.toString()}`;
}
