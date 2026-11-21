import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import type { RateLimitRule } from "@/actions/server/rateLimit/rateLimitRules";
import { MEDIA_BUCKET } from "@/lib/storage/mediaBucket";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { buildAttachedMediaPath } from "../_shared/buildAttachedMediaPath";
import { enforceStorageQuota } from "../_shared/enforceStorageQuota";
import { getUploadLimitsForPrincipal } from "../_shared/getUploadLimitsForPrincipal";
import { withMemoizedJsonSchema } from "../_shared/memoizedJsonSchema";
import { safeUserFetch } from "../_shared/safeUserFetch";
import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const AttachMediaFromUrlInputSchema = z.object({
  url: z.url().describe("Public http(s) URL of the file."),
});

const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

const ALLOWED_CONTENT_TYPE_PREFIXES = ["image/", "video/"];

const ATTACH_MEDIA_FROM_URL_RATE_LIMIT: RateLimitRule = { limit: 10, windowSeconds: 60 };

const AttachMediaFromUrlOutputSchema = z.object({
  storage_path: z.string(),
  content_type: z.string(),
  size_bytes: z.number(),
});

const ATTACH_MEDIA_FROM_URL_TOOL = {
  title: "Attach Media From URL",
  description:
    "Copy an image or video from a public URL into storage (JPEG, PNG, GIF, WebP, MP4, MOV, WebM; no redirects). Returns storage_path to pass as media_storage_path in publish_posts.",
  inputSchema: withMemoizedJsonSchema(AttachMediaFromUrlInputSchema),
  outputSchema: withMemoizedJsonSchema(AttachMediaFromUrlOutputSchema),
  annotations: {
    title: "Attach Media From URL",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

const handleAttachMediaFromUrl = withMcpTool(
  "attach_media_from_url",
  async (ctx, args: z.infer<typeof AttachMediaFromUrlInputSchema>) => {
    const rateLimitResult = await checkRateLimit({
      operation: "mcp_attach_media_from_url",
      identifier: ctx.principal.principalId,
      rule: ATTACH_MEDIA_FROM_URL_RATE_LIMIT,
    });
    if (!rateLimitResult.success) {
      return errorResult(
        rateLimitResult.message,
        rateLimitResult.reason === "limited" ? "rate_limited" : "error",
      );
    }

    const uploadLimits = getUploadLimitsForPrincipal(ctx.principal.plan);
    const maxBytes =
      Math.max(uploadLimits.image, uploadLimits.video) * 1024 * 1024;

    const fetchResult = await safeUserFetch(args.url, {
      maxBytes,
      allowedContentTypePrefixes: ALLOWED_CONTENT_TYPE_PREFIXES,
      allowedContentTypes: ALLOWED_CONTENT_TYPES,
      connectTimeoutMs: 5_000,
      totalTimeoutMs: 30_000,
    });

    if (!fetchResult.success) {
      const isDenied =
        fetchResult.reason === "blocked_scheme" ||
        fetchResult.reason === "blocked_host" ||
        fetchResult.reason === "blocked_ip" ||
        fetchResult.reason === "redirect_not_allowed" ||
        fetchResult.reason === "content_type_not_allowed" ||
        fetchResult.reason === "too_large" ||
        fetchResult.reason === "invalid_url";

      return errorResult(fetchResult.message, isDenied ? "denied" : "error");
    }

    const isVideo = fetchResult.contentType.startsWith("video/");
    const specificCapMb = isVideo ? uploadLimits.video : uploadLimits.image;
    const specificCapBytes = specificCapMb * 1024 * 1024;
    if (fetchResult.bytes.length > specificCapBytes) {
      return errorResult(
        `File too large: ${Math.round(fetchResult.bytes.length / 1024 / 1024)} MB. ` +
          `${isVideo ? "Video" : "Image"} limit is ${specificCapMb} MB.`,
        "denied",
      );
    }

    const quotaResult = await enforceStorageQuota(
      ctx.principal.principalId,
      ctx.principal.plan,
      fetchResult.bytes.length,
    );
    if (!quotaResult.success) {
      return errorResult(
        quotaResult.message,
        quotaResult.reason === "quota_exceeded" ? "denied" : "error",
      );
    }

    const storagePath = buildAttachedMediaPath(
      ctx.principal.principalId,
      fetchResult.contentType,
    );

    try {
      const { error: uploadError } = await adminSupabase.storage
        .from(MEDIA_BUCKET)
        .upload(storagePath, fetchResult.bytes, {
          contentType: fetchResult.contentType,
          upsert: false,
        });

      if (uploadError) {
        console.error("[attach_media_from_url] Storage upload failed:", uploadError.message);
        return errorResult("Could not store the file. Retry in a moment.");
      }
    } catch (uploadThrown) {
      console.error(
        "[attach_media_from_url] Storage upload threw:",
        uploadThrown instanceof Error ? uploadThrown.message : uploadThrown,
      );
      return errorResult("Could not store the file. Retry in a moment.");
    }

    return jsonResult(
      {
        storage_path: storagePath,
        content_type: fetchResult.contentType,
        size_bytes: fetchResult.bytes.length,
      } satisfies z.infer<typeof AttachMediaFromUrlOutputSchema>,
      { url: args.url, storagePath },
    );
  },
  { auditArgsBuilder: (args) => ({ url: args.url }) },
);

export function registerAttachMediaFromUrl(server: McpServer): void {
  server.registerTool("attach_media_from_url", ATTACH_MEDIA_FROM_URL_TOOL, handleAttachMediaFromUrl);
}
