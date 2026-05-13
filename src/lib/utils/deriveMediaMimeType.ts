/**
 * Derives a best-effort MIME type from filename extension + post category.
 * Used worker-side when the scheduled post does not store a stored MIME.
 *
 * Falls back to image/jpeg or video/mp4 for unknown extensions.
 * Returns empty string for text posts.
 */
export function deriveMediaMimeType(
  fileName: string,
  postType: "text" | "image" | "video",
): string {
  if (postType === "text") return "";
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (postType === "image") {
    if (ext === "png") return "image/png";
    if (ext === "webp") return "image/webp";
    if (ext === "gif") return "image/gif";
    return "image/jpeg";
  }
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "video/mp4";
}
