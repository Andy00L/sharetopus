"use server";

import "server-only";

import { auth } from "@clerk/nextjs/server";
import { adminSupabase } from "@/actions/api/adminSupabase";
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
 * and prefix 'stp_rest_'. Raw key returned ONCE; later reads only see
 * the prefix.
 *
 * Requires an active Clerk session. Subscription gating happens at
 * resolveRestApiKey time, not creation time (matches MCP).
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

    const { rawKey, prefix, tokenHash } = generateApiKey("rest");
    const expiresAtDate = new Date();
    expiresAtDate.setDate(expiresAtDate.getDate() + expiresInDays);
    const expiresAtIso = expiresAtDate.toISOString();

    const { data: insertedRow, error: insertError } = await adminSupabase
      .from("api_keys")
      .insert({
        principal_id: clerkUserId,
        name: trimmedName,
        prefix,
        token_hash: tokenHash,
        kind: "rest",
        scopes: ["api:full"],
        expires_at: expiresAtIso,
      })
      .select("id")
      .single();

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
