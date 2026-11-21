import "server-only";

export type TikTokClientCredentials = { clientKey: string; clientSecret: string };

export function readTikTokClientCredentials(): TikTokClientCredentials | null {
  const isDevelopment = process.env.NODE_ENV === "development";
  const clientKey = isDevelopment
    ? process.env.TIKTOK_CLIENT_KEY_DEV
    : process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = isDevelopment
    ? process.env.TIKTOK_CLIENT_SECRET_DEV
    : process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return null;
  return { clientKey, clientSecret };
}
