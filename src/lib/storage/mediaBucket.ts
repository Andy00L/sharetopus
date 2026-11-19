import "server-only";

export const MEDIA_BUCKET =
  process.env.SUPABASE_BUCKET_NAME || "scheduled-videos";
