import "server-only";

/**
 * The Supabase Storage bucket that holds every uploaded media file. Uploads,
 * downloads, signed view URLs, the media proxy, deletes, the orphan sweep
 * and the storage quota all read this one name, so they cannot drift apart.
 * SUPABASE_BUCKET_NAME overrides it (docs/DEVELOPMENT.md); unset or empty,
 * it is the bucket every environment uses today.
 */
export const MEDIA_BUCKET =
  process.env.SUPABASE_BUCKET_NAME || "scheduled-videos";
