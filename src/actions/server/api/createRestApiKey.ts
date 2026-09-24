"use server";

import "server-only";

import { auth } from "@clerk/nextjs/server";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import { checkActiveApiKeyCap } from "@/lib/api/checkActiveApiKeyCap";
import { generateApiKey } from "@/lib/api/tokens";
import {
  DEFAULT_API_KEY_EXPIRY_DAYS,
  isValidApiKeyExpiryDays,
} from "@/lib/mcp/apiKeyExpiry";

export type CreateRestApiKeyInput = {
  name: string;
  expiresInDays?: number;
};

export type CreateRestApiKeyResult =
  | {
      success: true;
      rawKey: string;
      keyId: string;
      prefix: string;
      expiresAtIso: string;
    }
  | {
      success: false;
      message: string;
    };

/**
 * Creates a REST API key for the authenticated user.
 *
 * Mirrors src/actions/server/mcp/createApiKey.ts but with kind='rest'
 * and prefix 'stp_rest_': the same creation rate limit and the same cap on
 * unrevoked keys (checkActiveApiKeyCap). Raw key returned ONCE; later reads
 * only see the prefix.
 *
 * Requires an active Clerk session. Unlike MCP, creation does not check the
 * subscription: resolveRestApiKey gates every request made with the key, and
 * the integrations page that calls this is gated too.
 */
export async function createRestApiKey(
  input: CreateRestApiKeyInput,
): Promise<CreateRestApiKeyResult> {
  try {
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return { success: false, message: "Not authenticated" };
    }

    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { success: false, message: "Key name is required" };
    }
    if (trimmedName.length > 100) {
      return {
        success: false,
        message: "Key name too long (max 100 chars)",
      };
    }

    const expiresInDays =
      input.expiresInDays ?? DEFAULT_API_KEY_EXPIRY_DAYS;
    if (!isValidApiKeyExpiryDays(expiresInDays)) {
      return { success: false, message: "Invalid expiry duration" };
    }

    const rateCheck = await checkRateLimit(
      "rest.createApiKey",
      clerkUserId,
      10,
      60,
    );
    if (!rateCheck.success) {
      return { success: false, message: rateCheck.message ?? "Rate limited." };
    }

    const keyCap = await checkActiveApiKeyCap(clerkUserId, "rest");
    if (!keyCap.ok) {
      return { success: false, message: keyCap.message };
    }

    const { rawKey, prefix, tokenHash } = generateApiKey("rest");
    const expiresAtDate = new Date();
    expiresAtDate.setDate(expiresAtDate.getDate() + expiresInDays);
    const expiresAtIso = expiresAtDate.toISOString();

    const { data: insertedRows, error: insertError } = await runQuery(
      db
        .insert(api_keys)
        .values({
          principal_id: clerkUserId,
          name: trimmedName,
          prefix,
          token_hash: tokenHash,
          kind: "rest",
          scopes: ["api:full"],
          expires_at: expiresAtIso,
        })
        .returning({ id: api_keys.id }),
    );

    const insertedRow = insertedRows?.[0];
    if (insertError || !insertedRow) {
      console.error(
        "[createRestApiKey] insert failed:",
        insertError?.message ?? "unknown",
      );
      return { success: false, message: "Failed to create key" };
    }

    return {
      success: true,
      rawKey,
      keyId: insertedRow.id,
      prefix,
      expiresAtIso,
    };
  } catch (unexpectedError) {
    console.error(
      "[createRestApiKey] unexpected error:",
      unexpectedError instanceof Error
        ? unexpectedError.message
        : unexpectedError,
    );
    return { success: false, message: "Internal error" };
  }
}
