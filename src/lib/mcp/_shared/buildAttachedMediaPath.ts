import "server-only";

import { randomUUID } from "node:crypto";

export function buildAttachedMediaPath(
  principalId: string,
  contentType: string,
): string {
  const extension = contentType.startsWith("video/") ? "mp4" : "jpg";
  return `${principalId}/${randomUUID()}.${extension}`;
}
