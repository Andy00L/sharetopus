import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generateServerSignedUploadUrl } from "@/actions/server/data/generateServerSignedUploadUrl";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { entitlementFor } from "../entitlement";
import { logToolCall } from "../audit";
import { extractPrincipal, extractSessionId, extractIpHash, extractUserAgent } from "@/lib/mcp/context";

/**
 * Mints a Supabase signed upload URL so agents can upload media
 * bytes directly to storage without routing through Vercel.
 *
 * Plan gate: Starter+
 * Tables touched: none (reads from Supabase Storage for quota check)
 *
 * Agent flow:
 *   1. Call request_upload_url(filename, content_type, size_bytes)
 *   2. PUT bytes to the returned upload_url
 *   3. Call post_now or schedule_post with media_storage_path = storage_path
 *
 * Known limitation: if the agent uploads a file but never calls
 * post_now or schedule_post, the file becomes an orphan in storage
 * and still counts toward the user's storage quota. A future cleanup
 * job should sweep unreferenced files older than 24h.
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
            "MIME type of the file. Allowed: image/jpeg, image/png, video/mp4, video/mov, video/quicktime"
          ),
        size_bytes: z
          .number()
          .int()
          .positive()
          .describe("File size in bytes"),
      },
      annotations: {
        title: "Request Upload URL",
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      const principal = extractPrincipal(extra);
      const sessionId = extractSessionId(extra);
      const ipHash = await extractIpHash();
      const userAgent = await extractUserAgent();
      const start = Date.now();

      // 1. Entitlement check
      const ent = await entitlementFor(principal, "request_upload_url");
      if (ent.mode === "deny") {
        await logToolCall({
          principal,
          sessionId,
          toolName: "request_upload_url",
          args,
          resultStatus:
            ent.reason === "platform_quota" || ent.reason === "monthly_quota"
              ? "quota_exceeded"
              : "denied",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            { type: "text" as const, text: `Denied: ${ent.detail}` },
          ],
          isError: true,
        };
      }

      // 1b. Rate limit
      const rateCheck = await checkRateLimit(
        "mcp_request_upload_url",
        principal.principalId,
        20,
        60
      );
      if (!rateCheck.success) {
        await logToolCall({
          principal,
          sessionId,
          toolName: "request_upload_url",
          args,
          resultStatus: "rate_limited",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: rateCheck.message ?? "Rate limit exceeded. Please slow down and retry.",
            },
          ],
          isError: true,
        };
      }

      // 2. Call shared helper
      const result = await generateServerSignedUploadUrl({
        principalId: principal.principalId,
        priceId: principal.priceId,
        filename: args.filename,
        contentType: args.content_type,
        fileSize: args.size_bytes,
        countTowardStorage: true,
      });

      if (!result.success) {
        console.error(
          `[mcp/request_upload_url] Helper rejected: ${result.reason} -- ${result.message}`
        );
        await logToolCall({
          principal,
          sessionId,
          toolName: "request_upload_url",
          args,
          resultStatus: "error",
          latencyMs: Date.now() - start,
          ipHash,
          userAgent,
        });
        return {
          content: [
            { type: "text" as const, text: result.message },
          ],
          isError: true,
        };
      }

      // 3. Success
      await logToolCall({
        principal,
        sessionId,
        toolName: "request_upload_url",
        args,
        resultStatus: "ok",
        latencyMs: Date.now() - start,
        ipHash,
        userAgent,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                success: true,
                upload_url: result.uploadUrl,
                storage_path: result.path,
                token: result.token,
                expires_in_seconds: 7200,
                curl_example: `curl -X PUT "${result.uploadUrl}" -H "Content-Type: ${args.content_type}" --data-binary @<your_file>`,
                next_step:
                  "Upload bytes to upload_url, then call post_now or schedule_post with media_storage_path = storage_path.",
                whitelist_note:
                  "If you are running inside Claude.ai or Claude Desktop with Code Execution, ensure your Supabase project domain is whitelisted under Settings -> Capabilities -> Code execution and file creation -> Additional allowed domains.",
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
