import "server-only";

import { generateServerSignedUploadUrl } from "@/actions/server/data/generateServerSignedUploadUrl";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { withMcpTool } from "../withMcpTool";

type RequestUploadUrlArgs = {
  filename: string;
  content_type: string;
  size_bytes: number;
};

/**
 * Mints a Supabase signed upload URL so agents can upload media bytes
 * directly to storage without routing through Vercel.
 *
 * Plan gate: starter+ (entitlement gate + monthly quota enforced by HOF).
 * Tables touched: none (reads from Supabase Storage for quota check).
 *
 * Agent flow:
 *   1. Call request_upload_url(filename, content_type, size_bytes)
 *   2. PUT bytes to the returned upload_url
 *   3. Call post_now or schedule_post with media_storage_path = storage_path
 *
 * Known limitation: if the agent uploads a file but never calls
 * post_now or schedule_post, the file becomes an orphan in storage and
 * still counts toward the user's storage quota. A future cleanup job
 * should sweep unreferenced files older than 24h.
 */
export function registerRequestUploadUrl(server: McpServer): void {
  server.registerTool(
    "request_upload_url",
    {
      title: "Request Upload URL",
      description:
        "Get a signed upload URL for uploading media (image/video) directly to Sharetopus storage. Returns a URL + storage_path for use with post_now or schedule_post.",
      inputSchema: {
        filename: z
          .string()
          .min(1)
          .describe("Filename including extension (e.g. photo.jpg, clip.mp4)"),
        content_type: z
          .string()
          .min(1)
          .describe(
            "MIME type of the file. Allowed: image/jpeg, image/png, video/mp4, video/mov, video/quicktime",
          ),
        size_bytes: z.number().int().positive().describe("File size in bytes"),
      },
      annotations: {
        title: "Request Upload URL",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    withMcpTool(
      "request_upload_url",
      async (ctx, args: RequestUploadUrlArgs) => {
        const rateLimitResult = await checkRateLimit(
          "mcp_request_upload_url",
          ctx.principal.principalId,
          20,
          60,
        );
        if (!rateLimitResult.success) {
          return {
            content: [
              {
                type: "text",
                text:
                  rateLimitResult.message ??
                  "Rate limit exceeded. Please slow down and retry.",
              },
            ],
            isError: true,
            auditStatus: "rate_limited",
          };
        }

        const uploadUrlResult = await generateServerSignedUploadUrl({
          principalId: ctx.principal.principalId,
          tier: ctx.principal.plan,
          filename: args.filename,
          contentType: args.content_type,
          fileSize: args.size_bytes,
          countTowardStorage: true,
        });

        if (!uploadUrlResult.success) {
          console.error(
            `[mcp/request_upload_url] [req=${ctx.requestId ?? "?"}] Helper rejected: ${uploadUrlResult.reason} -- ${uploadUrlResult.message}`,
          );
          return {
            content: [{ type: "text", text: uploadUrlResult.message }],
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
                  upload_url: uploadUrlResult.uploadUrl,
                  storage_path: uploadUrlResult.path,
                  token: uploadUrlResult.token,
                  expires_in_seconds: 7200,
                  curl_example: `curl -X PUT "${uploadUrlResult.uploadUrl}" -H "Content-Type: ${args.content_type}" --data-binary @<your_file>`,
                  next_step:
                    "Upload bytes to upload_url, then call post_now or schedule_post with media_storage_path = storage_path.",
                  whitelist_note:
                    "If you are running inside Claude.ai or Claude Desktop with Code Execution, ensure your Supabase project domain is whitelisted under Settings -> Capabilities -> Code execution and file creation -> Additional allowed domains.",
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    ),
  );
}
