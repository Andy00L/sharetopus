"use server";

import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";

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
  isValidApiKeyExpiryDays,
} from "@/lib/mcp/apiKeyExpiry";

const MANAGED_API_KEY_KINDS: ApiKeyKind[] = ["mcp", "rest"];
const API_KEY_NAME_MAX_CHARS = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

export async function createApiKey(input: {
  kind: ApiKeyKind;
  name: string;
  expiresInDays: number;
}): Promise<CreateApiKeyResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }
  if (!isApiKeyKind(input.kind)) {
    return { success: false, message: "Unknown key kind." };
  }

  const keyName = input.name.trim();
  if (!keyName) {
    return { success: false, message: "Key name is required." };
  }
  if (keyName.length > API_KEY_NAME_MAX_CHARS) {
    return {
      success: false,
      message: `Key name must be at most ${API_KEY_NAME_MAX_CHARS} characters.`,
    };
  }
  if (!isValidApiKeyExpiryDays(input.expiresInDays)) {
    return {
      success: false,
      message: `Invalid expiry duration. Allowed: ${API_KEY_EXPIRY_DAYS_OPTIONS.join(", ")} days.`,
    };
  }

  const keyRules = KEY_RULES_BY_KIND[input.kind];
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

  const keyCap = await checkActiveApiKeyCap(userId, input.kind);
  if (!keyCap.ok) {
    return { success: false, message: keyCap.message };
  }

  const { rawKey, prefix, tokenHash } = generateApiKey(input.kind);
  const expiresAtIso = new Date(
    Date.now() + input.expiresInDays * MS_PER_DAY,
  ).toISOString();

  const { data: insertedKeys, error } = await runQuery(
    db
      .insert(api_keys)
      .values({
        principal_id: userId,
        name: keyName,
        prefix,
        token_hash: tokenHash,
        kind: input.kind,
        scopes: keyRules.scopes,
        expires_at: expiresAtIso,
      })
      .returning({ id: api_keys.id }),
  );

  const insertedKey = insertedKeys?.[0];
  if (error || !insertedKey) {
    console.error(
      `[createApiKey] Insert of a ${input.kind} key failed:`,
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
          inArray(api_keys.kind, MANAGED_API_KEY_KINDS),
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

export async function revokeApiKey(input: {
  kind: ApiKeyKind;
  keyId: string;
}): Promise<{ success: boolean; message: string }> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }
  if (!isApiKeyKind(input.kind)) {
    return { success: false, message: "Unknown key kind." };
  }
  if (!input.keyId) {
    return { success: false, message: "Key ID is required." };
  }
  return revokeApiKeyForPrincipal(userId, input.keyId, input.kind);
}

function isApiKeyKind(kind: unknown): kind is ApiKeyKind {
  return MANAGED_API_KEY_KINDS.some((managedKind) => managedKind === kind);
}
