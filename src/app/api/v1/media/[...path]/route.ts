import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { ViewUrlQuerySchema } from "@/lib/api/rest/validation/mediaSchemas";
import type {
  MediaDeleteResult,
  MediaViewUrl,
} from "@/lib/api/rest/openapi/responseSchemas";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { deleteSupabaseFile } from "@/actions/server/data/storageFiles/deleteSupabaseFile";
import { isOwnedMediaPath } from "@/lib/storage/mediaPath";

/**
 * Extracts the storage path from the catch-all URL.
 * URL shape: /api/v1/media/{principalId}/{filename.ext}
 * The catch-all [...path] captures everything after /media/.
 */
function extractStoragePath(requestUrl: string): string {
  const urlPathname = new URL(requestUrl).pathname;
  const mediaPrefix = "/api/v1/media/";
  return urlPathname.slice(mediaPrefix.length);
}

/**
 * GET /v1/media/[...path] -- get a signed view URL for a file.
 *
 * The catch-all [...path] captures storage paths that contain slashes
 * (e.g. "user_abc/photo.jpg"). A path outside the principal's folder,
 * traversal included, is refused by isOwnedMediaPath with 403.
 *
 * Query: ?expires_in_seconds=300 (1-3600, default 300).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.view_url",
  handler: async (ctx, request) => {
    const storagePath = extractStoragePath(request.url);
    if (!isOwnedMediaPath(storagePath, ctx.principal.principalId)) {
      return restErrorResponse(
        "forbidden",
        "You can only access your own files",
        ctx.requestId,
      );
    }

    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = ViewUrlQuerySchema.safeParse(queryObject);
    const expiresInSeconds = queryParseResult.success
      ? queryParseResult.data.expires_in_seconds
      : 300;

    const viewUrlResult = await getServerSignedViewUrl(
      storagePath,
      expiresInSeconds,
    );
    if (!viewUrlResult.success) {
      return restErrorResponse(
        "not_found",
        "File not found in storage",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          view_url: viewUrlResult.url,
          expires_in_seconds: expiresInSeconds,
        } satisfies MediaViewUrl,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        storage_path: storagePath,
        expires_in_seconds: expiresInSeconds,
      },
    };
  },
});

/**
 * DELETE /v1/media/[...path] -- reference-aware file delete.
 *
 * Reuses deleteSupabaseFile which checks references in
 * scheduled_posts, failed_posts, pending_tiktok_pulls, and
 * pending_direct_posts before removing. Returns deleted:false
 * if the file is still referenced (preserved).
 */
export const DELETE = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.delete",
  handler: async (ctx, request) => {
    const storagePath = extractStoragePath(request.url);
    if (!isOwnedMediaPath(storagePath, ctx.principal.principalId)) {
      return restErrorResponse(
        "forbidden",
        "You can only delete your own files",
        ctx.requestId,
      );
    }

    const deleteResult = await deleteSupabaseFile(
      ctx.principal.principalId,
      storagePath,
      false,
    );

    // The helper's failure message can carry database text: log it, answer
    // the caller with a plain one.
    if (!deleteResult.success) {
      console.error(
        `[v1/media DELETE] delete failed (request_id=${ctx.requestId}): ${deleteResult.message}`,
      );
      return restErrorResponse(
        "internal_error",
        "Could not delete the file. Please try again.",
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          storage_path: storagePath,
          deleted: deleteResult.removed,
        } satisfies MediaDeleteResult,
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        storage_path: storagePath,
        deleted: deleteResult.removed,
      },
    };
  },
});
