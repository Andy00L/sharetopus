import "server-only";

import { generateServerSignedUploadUrl } from "@/actions/server/data/generateServerSignedUploadUrl";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import type { RateLimitRule } from "@/actions/server/rateLimit/rateLimitRules";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { withMemoizedJsonSchema } from "../_shared/memoizedJsonSchema";
import { errorResult, jsonResult, withMcpTool } from "../withMcpTool";

const RequestUploadUrlInputSchema = z.object({
  filename: z.string().min(1).describe("With extension, e.g. clip.mp4."),
  content_type: z
    .string()
    .min(1)
    .describe("image/jpeg, image/png, video/mp4 or video/quicktime (.mov)."),
  size_bytes: z.number().int().positive(),
});

/** Signed upload URL valid 2 hours. */
const UPLOAD_URL_TTL_SECONDS = 7200;

const REQUEST_UPLOAD_URL_RATE_LIMIT: RateLimitRule = { limit: 20, windowSeconds: 60 };

const RequestUploadUrlOutputSchema = z.object({
  upload_url: z.string(),
  storage_path: z.string(),
  token: z.string(),
  expires_in_seconds: z.number(),
});

const REQUEST_UPLOAD_URL_TOOL = {
  title: "Request Upload URL",
  description:
    "Get a signed URL to upload a local image or video yourself: PUT the bytes to upload_url with the file's Content-Type, then pass storage_path as media_storage_path in publish_posts.",
  inputSchema: withMemoizedJsonSchema(RequestUploadUrlInputSchema),
  outputSchema: withMemoizedJsonSchema(RequestUploadUrlOutputSchema),
  annotations: {
    title: "Request Upload URL",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
};

const handleRequestUploadUrl = withMcpTool(
  "request_upload_url",
  async (ctx, args: z.infer<typeof RequestUploadUrlInputSchema>) => {
    const rateLimitResult = await checkRateLimit({
      operation: "mcp_request_upload_url",
      identifier: ctx.principal.principalId,
      rule: REQUEST_UPLOAD_URL_RATE_LIMIT,
    });
    if (!rateLimitResult.success) {
      return errorResult(
        rateLimitResult.message,
        rateLimitResult.reason === "limited" ? "rate_limited" : "error",
      );
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
      return errorResult(uploadUrlResult.message);
    }

    return jsonResult({
      upload_url: uploadUrlResult.uploadUrl,
      storage_path: uploadUrlResult.path,
      token: uploadUrlResult.token,
      expires_in_seconds: UPLOAD_URL_TTL_SECONDS,
    } satisfies z.infer<typeof RequestUploadUrlOutputSchema>);
  },
);

/**
 * Signed upload URL so an agent PUTs the bytes straight to storage. An upload
 * no post ever uses is swept by the daily orphan cleanup after 24 h.
 */
export function registerRequestUploadUrl(server: McpServer): void {
  server.registerTool("request_upload_url", REQUEST_UPLOAD_URL_TOOL, handleRequestUploadUrl);
}
