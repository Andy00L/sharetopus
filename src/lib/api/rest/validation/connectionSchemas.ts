import { z } from "zod";

import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";

/**
 * Supported platforms for OAuth initiation via REST. Every posting
 * platform (shared registry in src/lib/platforms/capabilities.ts) has an
 * OAuth flow behind /api/oauth/callback/[platform].
 */
const OAuthPlatformEnum = z.enum(POSTING_PLATFORMS);

/**
 * All platforms stored in social_accounts (superset of posting platforms).
 * Used for connection list filtering where any connected platform may appear.
 */
const AllPlatformEnum = z.enum([
  "linkedin",
  "tiktok",
  "pinterest",
  "instagram",
  "facebook",
  "threads",
  "youtube",
  "x",
]);

/**
 * Body schema for POST /v1/connections/initiate.
 *
 * Starts an OAuth flow and returns the authorization URL. The caller
 * must direct the user to visit the URL in their browser.
 *
 * There is intentionally no client-supplied redirect URL: the callback
 * URI is fixed per platform (/api/oauth/callback/[platform]). Accepting a
 * client redirect target is an open-redirect / auth-code-exfiltration
 * risk, so it is not exposed.
 */
export const ConnectionInitiateInputSchema = z.object({
  platform: OAuthPlatformEnum,
});

export type ConnectionInitiateInput = z.infer<
  typeof ConnectionInitiateInputSchema
>;

/**
 * Query schema for GET /v1/connections.
 *
 * Cursor pagination on created_at, with optional platform filter
 * and availability toggle.
 */
export const ConnectionListQuerySchema = z.object({
  include_unavailable: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  platform: AllPlatformEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type ConnectionListQuery = z.infer<typeof ConnectionListQuerySchema>;

/**
 * Query schema for GET /v1/connections/[id]/boards.
 */
export const PinterestBoardsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  bookmark: z.string().optional(),
});

export type PinterestBoardsQuery = z.infer<typeof PinterestBoardsQuerySchema>;
