import { z } from "zod";

import { SOCIAL_PLATFORMS } from "@/db/schema";
import { ADAPTER_PLATFORMS } from "@/lib/platforms/capabilities";
import { REGISTRY_CREDENTIALS_PLATFORM_IDS } from "@/lib/platforms/providers/catalog";
import { CreatedAtCursorSchema } from "@/lib/api/rest/pagination";

const OAuthPlatformEnum = z.enum(ADAPTER_PLATFORMS);

const AllPlatformEnum = z.enum(SOCIAL_PLATFORMS);

export const ConnectionInitiateInputSchema = z.object({
  platform: OAuthPlatformEnum,
});

export type ConnectionInitiateInput = z.infer<
  typeof ConnectionInitiateInputSchema
>;

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

export const PinterestBoardsQuerySchema = z.object({
  page_size: z.coerce.number().int().min(1).max(100).default(25),
  bookmark: z.string().optional(),
});

export type PinterestBoardsQuery = z.infer<typeof PinterestBoardsQuerySchema>;

const MAX_CREDENTIAL_VALUE_ENTRIES = 20;

export const CredentialsConnectInputSchema = z.object({
  provider: z.enum(REGISTRY_CREDENTIALS_PLATFORM_IDS),
  values: z
    .record(z.string().max(64), z.string().max(2048))
    .refine(
      (record) => Object.keys(record).length <= MAX_CREDENTIAL_VALUE_ENTRIES,
      { message: `At most ${MAX_CREDENTIAL_VALUE_ENTRIES} values are accepted.` },
    ),
});

export const ConnectionToolTriggerInputSchema = z.object({
  method_name: z.string().min(1).max(100),
  parameters: z.record(z.string(), z.unknown()).default({}),
});
