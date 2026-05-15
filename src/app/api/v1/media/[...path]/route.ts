import { NextResponse } from "next/server";

import { withRestEndpoint } from "@/lib/api/rest/middleware/withRestEndpoint";
import { restErrorResponse } from "@/lib/api/rest/errors/restErrorResponse";
import { ViewUrlQuerySchema } from "@/lib/api/rest/validation/mediaSchemas";
import { getServerSignedViewUrl } from "@/actions/server/data/getServerSignedViewUrl";
import { deleteSupabaseFile } from "@/actions/server/data/storageFiles/deleteSupabaseFile";

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
 * Validates a storage path: non-empty, no traversal, no leading slash.
 */
function isValidStoragePath(storagePath: string): boolean {
  return (
    storagePath.length > 0 &&
    !storagePath.includes("..") &&
    !storagePath.startsWith("/") &&
    !storagePath.includes("//")
  );
}

/**
 * GET /v1/media/[...path] -- get a signed view URL for a file.
 *
 * The catch-all [...path] captures storage paths that contain slashes
 * (e.g. "user_abc/photo.jpg"). Ownership validated by checking the
 * path starts with the principal's ID prefix.
 *
 * Query: ?expires_in_seconds=300 (1-3600, default 300).
 */
export const GET = withRestEndpoint({
  scopes: ["api:full"],
  rateLimitAction: "rest.media.view_url",
  handler: async (ctx, request) => {
    // Step 1: extract and validate storage path.
    const storagePath = extractStoragePath(request.url);
    if (!isValidStoragePath(storagePath)) {
      return restErrorResponse(
        "validation_error",
        "Invalid media path",
        ctx.requestId,
      );
    }

    // Step 2: ownership check.
    if (!storagePath.startsWith(`${ctx.principal.principalId}/`)) {
      return restErrorResponse(
        "forbidden",
        "You can only access your own files",
        ctx.requestId,
      );
    }

    // Step 3: parse query params.
    const queryObject = Object.fromEntries(
      new URL(request.url).searchParams,
    );
    const queryParseResult = ViewUrlQuerySchema.safeParse(queryObject);
    const expiresInSeconds = queryParseResult.success
      ? queryParseResult.data.expires_in_seconds
      : 300;

    // Step 4: generate signed view URL.
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
        },
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
    // Step 1: extract and validate storage path.
    const storagePath = extractStoragePath(request.url);
    if (!isValidStoragePath(storagePath)) {
      return restErrorResponse(
        "validation_error",
        "Invalid media path",
        ctx.requestId,
      );
    }

    // Step 2: ownership check.
    if (!storagePath.startsWith(`${ctx.principal.principalId}/`)) {
      return restErrorResponse(
        "forbidden",
        "You can only delete your own files",
        ctx.requestId,
      );
    }

    // Step 3: call shared helper (reference-aware, never throws).
    const deleteResult = await deleteSupabaseFile(
      ctx.principal.principalId,
      storagePath,
      false,
    );

    // Detect whether the file was actually removed. deleteSupabaseFile
    // returns success:true for both "deleted" and "preserved due to
    // references". The message text distinguishes the two outcomes.
    const wasDeleted =
      deleteResult.success &&
      deleteResult.message.includes("deleted successfully");

    if (!deleteResult.success) {
      return restErrorResponse(
        "internal_error",
        deleteResult.message,
        ctx.requestId,
      );
    }

    return {
      response: NextResponse.json(
        {
          storage_path: storagePath,
          deleted: wasDeleted,
        },
        { status: 200, headers: { "x-request-id": ctx.requestId } },
      ),
      auditSummary: {
        storage_path: storagePath,
        deleted: wasDeleted,
      },
    };
  },
});
