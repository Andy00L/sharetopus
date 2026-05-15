import { z } from "zod";

/**
 * Body schema for POST /v1/media/upload-url.
 */
export const UploadUrlInputSchema = z.object({
  filename: z.string().min(1).max(255),
  content_type: z.string().min(1),
  size_bytes: z.number().int().positive(),
});

export type UploadUrlInput = z.infer<typeof UploadUrlInputSchema>;

/**
 * Body schema for POST /v1/media/attach-from-url.
 */
export const AttachFromUrlInputSchema = z.object({
  url: z.string().url(),
  filename: z.string().min(1).max(255).optional(),
});

export type AttachFromUrlInput = z.infer<typeof AttachFromUrlInputSchema>;

/**
 * Query schema for GET /v1/media/[...path]/view-url.
 */
export const ViewUrlQuerySchema = z.object({
  expires_in_seconds: z.coerce.number().int().min(1).max(3600).default(300),
});

export type ViewUrlQuery = z.infer<typeof ViewUrlQuerySchema>;
