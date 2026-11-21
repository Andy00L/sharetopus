"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { CREATE_API_KEY_RATE_LIMIT } from "@/actions/server/rateLimit/rateLimitRules";
import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import { checkActiveApiKeyCap } from "@/lib/api/checkActiveApiKeyCap";
import { revokeApiKeyForPrincipal } from "@/lib/api/revokeApiKeyForPrincipal";
import { generateApiKey, type ApiKeyKind } from "@/lib/api/tokens";
import {
  API_KEY_EXPIRY_DAYS_OPTIONS,
  DEFAULT_API_KEY_EXPIRY_DAYS,
} from "@/lib/mcp/apiKeyExpiry";

const MANAGED_API_KEY_KINDS = ["mcp", "rest"] as const satisfies readonly ApiKeyKind[];
const API_KEY_NAME_MAX_CHARS = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ManagedApiKeyKindSchema = z.enum(MANAGED_API_KEY_KINDS, { error: "Unknown key kind." });

const CreateApiKeyInputSchema = z.object(
  {
    kind: ManagedApiKeyKindSchema,
    name: z
      .string({ error: "Key name is required." })
      .trim()
      .min(1, { error: "Key name is required." })
      .max(API_KEY_NAME_MAX_CHARS, {
        error: `Key name must be at most ${API_KEY_NAME_MAX_CHARS} characters.`,
      }),
    expiresInDays: z
      .literal(API_KEY_EXPIRY_DAYS_OPTIONS, {
        error: `Invalid expiry duration. Allowed: ${API_KEY_EXPIRY_DAYS_OPTIONS.join(", ")} days.`,
      })
      .default(DEFAULT_API_KEY_EXPIRY_DAYS),
  },
  { error: "Invalid request." },
);

const RevokeApiKeyInputSchema = z.object(
  {
    kind: ManagedApiKeyKindSchema,
    keyId: z.string({ error: "Key ID is required." }).min(1, { error: "Key ID is required." }),
  },
  { error: "Invalid request." },
);

export type CreateApiKeyInput = z.input<typeof CreateApiKeyInputSchema>;

export type RevokeApiKeyInput = z.input<typeof RevokeApiKeyInputSchema>;

const KEY_RULES_BY_KIND: Record<
  ApiKeyKind,
  { scopes: string[]; createRateLimitScope: string }
> = {
  mcp: { scopes: ["mcp:*"], createRateLimitScope: "mcp.createApiKey" },
  rest: { scopes: ["api:full"], createRateLimitScope: "rest.createApiKey" },
};

export type ListedApiKey = {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
};

export type CreateApiKeyResult =
  | {
      success: true;
      rawKey: string;
      keyId: string;
      prefix: string;
      expiresAtIso: string;
    }
  | { success: false; message: string };

export type ListApiKeysResult =
  | { success: true; keysByKind: Record<ApiKeyKind, ListedApiKey[]> }
  | { success: false; message: string };

export async function createApiKey(input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }
  const parsedInput = CreateApiKeyInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { success: false, message: describeFirstIssue(parsedInput.error) };
  }
  const { kind, name: keyName, expiresInDays } = parsedInput.data;

  const keyRules = KEY_RULES_BY_KIND[kind];
  const rateCheck = await checkRateLimit({
    operation: keyRules.createRateLimitScope,
    identifier: userId,
    rule: CREATE_API_KEY_RATE_LIMIT,
  });
  if (!rateCheck.success) {
    return { success: false, message: rateCheck.message };
  }

  const subscription = await checkActiveSubscription(userId);
  if (subscription.status === "unavailable") {
    return {
      success: false,
      message: "Could not check your subscription. Please try again.",
    };
  }
  if (!subscription.isActive) {
    return {
      success: false,
      message: "An active Sharetopus subscription is required to create API keys.",
    };
  }

  const keyCap = await checkActiveApiKeyCap(userId, kind);
  if (!keyCap.ok) {
    return { success: false, message: keyCap.message };
  }

  const { rawKey, prefix, tokenHash } = generateApiKey(kind);
  const expiresAtIso = new Date(Date.now() + expiresInDays * MS_PER_DAY).toISOString();

  const { data: insertedKeys, error } = await runQuery(
    db
      .insert(api_keys)
      .values({
        principal_id: userId,
        name: keyName,
        prefix,
        token_hash: tokenHash,
        kind,
        scopes: keyRules.scopes,
        expires_at: expiresAtIso,
      })
      .returning({ id: api_keys.id }),
  );

  const insertedKey = insertedKeys?.[0];
  if (error || !insertedKey) {
    console.error(
      `[createApiKey] Insert of a ${kind} key failed:`,
      error?.message ?? "no row returned",
    );
    return {
      success: false,
      message: "Could not create the API key. Please try again.",
    };
  }

  return {
    success: true,
    rawKey,
    keyId: insertedKey.id,
    prefix,
    expiresAtIso,
  };
}

export async function listApiKeys(): Promise<ListApiKeysResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  const { data: keyRows, error } = await runQuery(
    db
      .select({
        kind: api_keys.kind,
        id: api_keys.id,
        name: api_keys.name,
        prefix: api_keys.prefix,
        created_at: api_keys.created_at,
        last_used_at: api_keys.last_used_at,
        expires_at: api_keys.expires_at,
      })
      .from(api_keys)
      .where(
        and(
          eq(api_keys.principal_id, userId),
          inArray(api_keys.kind, [...MANAGED_API_KEY_KINDS]),
          isNull(api_keys.revoked_at),
        ),
      )
      .orderBy(desc(api_keys.created_at)),
  );

  if (error) {
    console.error(`[listApiKeys] Key list failed for ${userId}:`, error.message);
    return { success: false, message: "Could not load your API keys." };
  }

  const keysByKind: Record<ApiKeyKind, ListedApiKey[]> = { mcp: [], rest: [] };
  for (const { kind, ...listedKey } of keyRows) {
    if (isApiKeyKind(kind)) keysByKind[kind].push(listedKey);
  }
  return { success: true, keysByKind };
}

export async function revokeApiKey(
  input: RevokeApiKeyInput,
): Promise<{ success: boolean; message: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }
  const parsedInput = RevokeApiKeyInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { success: false, message: describeFirstIssue(parsedInput.error) };
  }
  return revokeApiKeyForPrincipal(userId, parsedInput.data.keyId, parsedInput.data.kind);
}

function isApiKeyKind(kind: unknown): kind is ApiKeyKind {
  return MANAGED_API_KEY_KINDS.some((managedKind) => managedKind === kind);
}

function describeFirstIssue(validationError: z.ZodError): string {
  return validationError.issues[0]?.message ?? "Invalid request.";
}
