import "server-only";

import { randomUUID } from "node:crypto";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";

import { enforceStorageQuota } from "../_shared/enforceStorageQuota";
import { getUploadLimitsForPrincipal } from "../_shared/getUploadLimitsForPrincipal";
import { safeUserFetch } from "../_shared/safeUserFetch";
import { withMcpTool } from "../withMcpTool";

type AttachMediaFromUrlArgs = {
  url: string;
  filename?: string;
};

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

/**
 * Fetches a media file from a public URL and uploads it to Supabase
 * Storage.
 *
 * Plan gate: starter+ (entitlement gate + monthly quota enforced by HOF).
 * Tables touched: none (writes to Supabase Storage, not a table).
 *
 * The returned storage path can be passed to schedule_post or
 * bulk_schedule as the media_storage_path field.
 *
 * Only accepts image and video content types. Per-user size caps are
 * enforced via streaming byte count (Content-Length is not trusted).
 * URLs are validated against SSRF attacks: DNS-resolved IPs are checked
 * against private/reserved ranges, redirects are rejected, and
 * non-http(s) schemes are blocked.
 *
 * Audit: full args include only `url` for deny / rate_limited / error
 * paths via auditArgsBuilder. On success, the handler-returned
 * auditArgs adds the resolved storage_path so analytics can correlate
 * uploads with downstream schedule_post / post_now calls.
 */
export function registerAttachMediaFromUrl(server: McpServer): void {
  server.registerTool(
    "attach_media_from_url",
    {
      title: "Attach Media From URL",
      description:
        "Download media from a public URL and upload it to Sharetopus storage. Returns a storage path for use with schedule_post.",
      inputSchema: {
        url: z.string().url().describe("Public HTTP(S) URL of the media file"),
        filename: z
          .string()
          .optional()
          .describe(
            "Optional label, retained for compatibility. The stored object name is always a random id; this value is not used to build the storage path.",
          ),
      },
      annotations: {
        title: "Attach Media From URL",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    withMcpTool(
      "attach_media_from_url",
      async (ctx, args: AttachMediaFromUrlArgs) => {
        // Rate limit before any network I/O.
        const rateLimitResult = await checkRateLimit(
          "mcp_attach_media_from_url",
          ctx.principal.principalId,
          10,
          60,
        );
        if (!rateLimitResult.success) {
          return {
            content: [
              {
                type: "text",
                text:
                  rateLimitResult.message ??
                  `Rate limit exceeded. Try again in ${rateLimitResult.resetIn ?? 60}s.`,
              },
            ],
            isError: true,
            auditStatus: "rate_limited",
          };
        }

        // Per-user upload size caps (MB -> bytes).
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

          return {
            content: [{ type: "text", text: fetchResult.message }],
            isError: true,
            auditStatus: isDenied ? "denied" : "error",
          };
        }

        // Type-specific size cap (image vs video).
        const isVideo = fetchResult.contentType.startsWith("video/");
        const specificCapMb = isVideo ? uploadLimits.video : uploadLimits.image;
        const specificCapBytes = specificCapMb * 1024 * 1024;
        if (fetchResult.bytes.length > specificCapBytes) {
          return {
            content: [
              {
                type: "text",
                text:
                  `File too large: ${Math.round(fetchResult.bytes.length / 1024 / 1024)} MB. ` +
                  `${isVideo ? "Video" : "Image"} limit is ${specificCapMb} MB.`,
              },
            ],
            isError: true,
            auditStatus: "denied",
          };
        }

        // Aggregate storage quota check (after download, before upload).
        const quotaResult = await enforceStorageQuota(
          ctx.principal.principalId,
          ctx.principal.plan,
          fetchResult.bytes.length,
        );
        if (!quotaResult.success) {
          return {
            content: [{ type: "text", text: quotaResult.message }],
            isError: true,
            auditStatus:
              quotaResult.reason === "quota_exceeded" ? "denied" : "error",
          };
        }

        // Build the storage key from a random UUID and a whitelisted
        // extension derived from the verified content type. The user
        // filename and URL basename are never interpolated into the object
        // key: that prevents path-traversal / tenant-prefix escape and
        // mirrors generateServerSignedUploadUrl.
        const ext = fetchResult.contentType.startsWith("video/")
          ? "mp4"
          : "jpg";
        const storagePath = `${ctx.principal.principalId}/${randomUUID()}.${ext}`;

        try {
          const { error: uploadError } = await adminSupabase.storage
            .from("scheduled-videos")
            .upload(storagePath, fetchResult.bytes, {
              contentType: fetchResult.contentType,
              upsert: false,
            });

          if (uploadError) {
            return {
              content: [
                {
                  type: "text",
                  text: `Storage upload failed: ${uploadError.message}`,
                },
              ],
              isError: true,
            };
          }
        } catch (uploadThrown) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to upload media: ${uploadThrown instanceof Error ? uploadThrown.message : "unknown error"}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  storage_path: storagePath,
                  content_type: fetchResult.contentType,
                  size_bytes: fetchResult.bytes.length,
                  message:
                    "Media uploaded. Use this storage_path as media_storage_path in schedule_post.",
                },
                null,
                2,
              ),
            },
          ],
          auditArgs: { url: args.url, storagePath },
        };
      },
      {
        // Default for deny / rate_limited / denied / error / thrown paths.
        // Success path overrides via handler-returned auditArgs to include
        // the resolved storage_path.
        auditArgsBuilder: (args) => ({ url: args.url }),
      },
    ),
  );
}
