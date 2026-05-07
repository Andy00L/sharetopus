import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { adminSupabase } from "@/actions/api/adminSupabase";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId } from "@/lib/mcp/context";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const ALLOWED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
];

/**
 * Fetches a media file from a public URL and uploads it to Supabase Storage.
 *
 * Plan gate: Starter+
 * Tables touched: none (writes to Supabase Storage, not a table)
 *
 * The returned storage path can be passed to schedule_post or bulk_schedule
 * as the media_storage_path field.
 *
 * Only accepts image and video content types. Rejects files over 100 MB.
 * Does not accept file:// or other non-HTTP schemes.
 */
export function registerAttachMediaFromUrl(server: McpServer): void {
  server.tool(
    "attach_media_from_url",
    "Download media from a public URL and upload it to Sharetopus storage. Returns a storage path for use with schedule_post.",
    {
      url: z.string().url().describe("Public HTTP(S) URL of the media file"),
      filename: z
        .string()
        .optional()
        .describe("Override filename (defaults to URL basename)"),
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
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
        });
        return {
          content: [{ type: "text", text: `Denied: ${ent.detail ?? ent.reason}` }],
          isError: true,
        };
      }

      // Validate URL scheme
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(args.url);
      } catch {
        return {
          content: [{ type: "text", text: "Invalid URL format." }],
          isError: true,
        };
      }
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return {
          content: [{ type: "text", text: "Only HTTP and HTTPS URLs are accepted." }],
          isError: true,
        };
      }

      try {
        // Fetch the file
        const response = await fetch(args.url, {
          headers: { "User-Agent": "Sharetopus-MCP/1.0" },
        });

        if (!response.ok) {
          return {
            content: [
              { type: "text", text: `Failed to fetch URL: HTTP ${response.status}` },
            ],
            isError: true,
          };
        }

        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
        if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
          return {
            content: [
              {
                type: "text",
                text: `Unsupported content type: ${contentType}. Allowed: ${ALLOWED_CONTENT_TYPES.join(", ")}`,
              },
            ],
            isError: true,
          };
        }

        const contentLength = parseInt(response.headers.get("content-length") ?? "0", 10);
        if (contentLength > MAX_FILE_SIZE) {
          return {
            content: [
              {
                type: "text",
                text: `File too large: ${Math.round(contentLength / 1024 / 1024)}MB. Max is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
              },
            ],
            isError: true,
          };
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        // Determine filename
        const urlBasename = parsedUrl.pathname.split("/").pop() ?? "media";
        const ext = contentType.startsWith("video/") ? ".mp4" : ".jpg";
        const filename =
          args.filename ?? (urlBasename.includes(".") ? urlBasename : `${urlBasename}${ext}`);

        const storagePath = `${principal.principalId}/${Date.now()}_${filename}`;

        const { error: uploadError } = await adminSupabase.storage
          .from("scheduled-videos")
          .upload(storagePath, buffer, {
            contentType,
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
          });
          return {
            content: [
              { type: "text", text: `Storage upload failed: ${uploadError.message}` },
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
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  success: true,
                  storage_path: storagePath,
                  content_type: contentType,
                  size_bytes: buffer.length,
                  message:
                    "Media uploaded. Use this storage_path as media_storage_path in schedule_post.",
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (err) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "attach_media_from_url",
          args: { url: args.url },
          resultStatus: "error",
          latencyMs: Date.now() - start,
        });
        return {
          content: [
            {
              type: "text",
              text: `Failed to fetch or upload media: ${err instanceof Error ? err.message : "unknown error"}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
