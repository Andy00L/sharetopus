import { z } from "zod";

import type { Platform } from "@/db/schema";
import { POSTING_PLATFORMS } from "@/lib/platforms/capabilities";
import { CreatedAtCursorSchema } from "@/lib/api/rest/pagination";

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
 * Keyset pagination on (created_at, id), with optional platform filter
 * and availability toggle.
 */
export const ConnectionListQuerySchema = z.object({
  include_unavailable: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => value === "true"),
  platform: AllPlatformEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: CreatedAtCursorSchema.optional(),
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

/**
 * Credentials providers servable through POST /v1/connections/credentials,
 * as DB platform values. The satisfies clause makes this list fail
 * compilation if a provider id ever drifts from the platform list, instead
 * of failing at insert time.
 */
const CREDENTIAL_PLATFORM_IDS = [
  "bluesky",
  "mastodon",
  "telegram",
  "discord",
  "slack",
  "devto",
  "wordpress",
  "hashnode",
  "medium",
  "lemmy",
  "farcaster",
  "listmonk",
  "nostr",
] as const satisfies readonly Platform[];

/**
 * Ceiling on submitted form entries. The largest declared field set today
 * is Listmonk's four; 20 leaves headroom while stopping a caller from
 * posting thousands of keys per request.
 */
const MAX_CREDENTIAL_VALUE_ENTRIES = 20;

/** Body schema for POST /v1/connections/credentials. */
export const CredentialsConnectInputSchema = z.object({
  provider: z.enum(CREDENTIAL_PLATFORM_IDS),
  /** Raw form values keyed by ProviderCredentialField.key. */
  values: z
    .record(z.string().max(64), z.string().max(2048))
    .refine(
      (record) => Object.keys(record).length <= MAX_CREDENTIAL_VALUE_ENTRIES,
      { message: `At most ${MAX_CREDENTIAL_VALUE_ENTRIES} values are accepted.` },
    ),
});

/** Body schema for POST /v1/connections/{id}/tools. */
export const ConnectionToolTriggerInputSchema = z.object({
  method_name: z.string().min(1).max(100),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
