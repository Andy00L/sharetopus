import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent, extractClientName, extractClientVersion } from "@/lib/mcp/context";
import { enforceStorageQuota } from "../_shared/enforceStorageQuota";
import { safeUserFetch } from "../_shared/safeUserFetch";
import { getUploadLimitsForPrincipal } from "../_shared/getUploadLimitsForPrincipal";

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
 * Fetches a media file from a public URL and uploads it to Supabase Storage.
 *
 * Plan gate: Starter+
 * Tables touched: none (writes to Supabase Storage, not a table)
 *
 * The returned storage path can be passed to schedule_post or bulk_schedule
 * as the media_storage_path field.
 *
 * Only accepts image and video content types. Per-user size caps are enforced
 * via streaming byte count (Content-Length is not trusted). URLs are validated
 * against SSRF attacks: DNS-resolved IPs are checked against private/reserved
 * ranges, redirects are rejected, and non-http(s) schemes are blocked.
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
          .describe("Override filename (defaults to URL basename)"),
      },
      annotations: {
        title: "Attach Media From URL",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const clientName = extractClientName(extra);
      const clientVersion = extractClientVersion(extra);
      const start = Date.now();

      const ent = await entitlementFor(principal, "attach_media_from_url");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      // Rate limit (before any network I/O)
      const rateCheck = await checkRateLimit(
        "mcp_attach_media_from_url",
        principal.principalId,
        10,
        60,
      );
      if (!rateCheck.success) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: "rate_limited",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: rateCheck.message ?? `Rate limit exceeded. Try again in ${rateCheck.resetIn ?? 60}s.`,
            },
          ],
          isError: true,
        };
      }

      // Per-user upload size caps (MB -> bytes)
      const limits = getUploadLimitsForPrincipal(principal.priceId);
      const maxBytes = Math.max(limits.image, limits.video) * 1024 * 1024;

      const result = await safeUserFetch(args.url, {
        maxBytes,
        allowedContentTypePrefixes: ALLOWED_CONTENT_TYPE_PREFIXES,
        allowedContentTypes: ALLOWED_CONTENT_TYPES,
        connectTimeoutMs: 5_000,
        totalTimeoutMs: 30_000,
      });

      if (!result.success) {
        const isDenied =
          result.reason === "blocked_scheme" ||
          result.reason === "blocked_host" ||
          result.reason === "blocked_ip" ||
          result.reason === "redirect_not_allowed" ||
          result.reason === "content_type_not_allowed" ||
          result.reason === "too_large" ||
          result.reason === "invalid_url";

        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: isDenied ? "denied" : "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [{ type: "text", text: result.message }],
          isError: true,
        };
      }

      // Type-specific size cap (image vs video)
      const isVideo = result.contentType.startsWith("video/");
      const specificCapMb = isVideo ? limits.video : limits.image;
      const specificCapBytes = specificCapMb * 1024 * 1024;
      if (result.bytes.length > specificCapBytes) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: `File too large: ${Math.round(result.bytes.length / 1024 / 1024)} MB. ` +
                `${isVideo ? "Video" : "Image"} limit is ${specificCapMb} MB.`,
            },
          ],
          isError: true,
        };
      }

      // Aggregate storage quota check (after download, before upload)
      const quota = await enforceStorageQuota(
        principal.principalId,
        principal.priceId,
        result.bytes.length,
      );
      if (!quota.success) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: quota.reason === "quota_exceeded" ? "denied" : "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [{ type: "text", text: quota.message }],
          isError: true,
        };
      }

      // Determine filename
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(args.url);
      } catch {
        parsedUrl = new URL("https://unknown/media");
      }
      const urlBasename = parsedUrl.pathname.split("/").pop() ?? "media";
      const ext = result.contentType.startsWith("video/") ? ".mp4" : ".jpg";
      const filename =
        args.filename ?? (urlBasename.includes(".") ? urlBasename : `${urlBasename}${ext}`);

      const storagePath = `${principal.principalId}/${Date.now()}_${filename}`;

      try {
        const { error: uploadError } = await adminSupabase.storage
          .from("scheduled-videos")
          .upload(storagePath, result.bytes, {
            contentType: result.contentType,
            upsert: false,
          });

        if (uploadError) {
          await logToolCall({
            principal,
            sessionId,
            toolName: "attach_media_from_url",
            args: { url: args.url },
            resultStatus: "error",
            latencyMs: Date.now() - start,
            ipHash,
            userAgent,
          });
          return {
            content: [
              { type: "text", text: `Storage upload failed: ${uploadError.message}` },
            ],
            isError: true,
          };
        }
      } catch (err) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
          clientName,
          clientVersion,
        });
        return {
          content: [
            {
              type: "text",
              text: `Failed to upload media: ${err instanceof Error ? err.message : "unknown error"}`,
            },
          ],
          isError: true,
        };
      }

      await logToolCall({
        principal,
        sessionId,
        toolName: "attach_media_from_url",
        args: { url: args.url, storagePath },
        resultStatus: "ok",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
        clientName,
        clientVersion,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                success: true,
                storage_path: storagePath,
                content_type: result.contentType,
                size_bytes: result.bytes.length,
                message:
                  "Media uploaded. Use this storage_path as media_storage_path in schedule_post.",
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
