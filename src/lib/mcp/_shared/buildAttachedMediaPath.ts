import "server-only";

import { randomUUID } from "node:crypto";

/**
 * Storage path for media fetched from a URL: the principal's folder, a random
 * id, and an extension from the verified content type. Nothing the caller
 * sends (a filename, the URL's last segment) goes into the key, so a value
 * such as "../other-user/x.jpg" cannot shape it or leave the principal's
 * folder. Mirrors generateServerSignedUploadUrl's {principalId}/{uuid}.{ext}.
 *
 * Shared by the MCP attach_media_from_url tool and
 * POST /v1/media/attach-from-url, which drifted apart once already.
 */
export function buildAttachedMediaPath(
  principalId: string,
  contentType: string,
): string {
  const extension = contentType.startsWith("video/") ? "mp4" : "jpg";
  return `${principalId}/${randomUUID()}.${extension}`;
}
