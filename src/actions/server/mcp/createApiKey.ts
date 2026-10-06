"use server";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { authCheck } from "@/actions/server/authCheck";
import { db, runQuery } from "@/db/client";
import { api_keys } from "@/db/schema";
import { checkActiveApiKeyCap } from "@/lib/api/checkActiveApiKeyCap";
import { generateApiKey } from "@/lib/api/tokens";
import { isValidApiKeyExpiryDays } from "@/lib/mcp/apiKeyExpiry";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

type CreateApiKeyResult =
  | { success: true; rawKey: string; keyId: string; prefix: string; expiresAtIso: string }
  | { success: false; message: string };

/**
 * Creates an MCP API key for a subscribed user; the raw key is returned once,
 * only its hash is stored.
 */
export async function createApiKey(
  userId: string | null,
  name: string,
  expiresInDays: number,
): Promise<CreateApiKeyResult> {
  try {
    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      return { success: false, message: "Authentication required." };
    }

    // MCP is a paid feature. Block key creation for users without an active subscription.
    const sub = await checkActiveSubscription(userId);
    if (sub.status === "unavailable") {
      return {
        success: false,
        message: "Could not check your subscription. Please try again.",
      };
    }
    if (!sub.isActive) {
      return {
        success: false,
        message: "An active Sharetopus subscription is required to create MCP API keys.",
      };
    }

    const rateCheck = await checkRateLimit("mcp.createApiKey", userId, 10, 60);
    if (!rateCheck.success) {
      return { success: false, message: rateCheck.message };
    }

    if (!name || name.trim().length === 0) {
      return { success: false, message: "Key name is required." };
    }
    if (name.length > 100) {
      return { success: false, message: "Key name must be under 100 characters." };
    }

    if (!isValidApiKeyExpiryDays(expiresInDays)) {
      return {
        success: false,
        message: "Invalid expiry duration. Allowed: 7, 30, 90, or 365 days.",
      };
    }

    const keyCap = await checkActiveApiKeyCap(userId, "mcp");
    if (!keyCap.ok) {
      return { success: false, message: keyCap.message };
    }

    const { rawKey, prefix, tokenHash } = generateApiKey("mcp");

    const millisecondsPerDay = 24 * 60 * 60 * 1000;
    const apiKeyExpiresAtIso = new Date(
      Date.now() + expiresInDays * millisecondsPerDay,
    ).toISOString();

    const { data: insertedKeys, error } = await runQuery(
      db
        .insert(api_keys)
        .values({
          principal_id: userId,
          name: name.trim(),
          prefix,
          token_hash: tokenHash,
          kind: "mcp",
          scopes: ["mcp:*"],
          expires_at: apiKeyExpiresAtIso,
        })
        .returning({ id: api_keys.id }),
    );

    const newKey = insertedKeys?.[0];
    if (error || !newKey) {
      console.error("[createApiKey] Insert failed:", error?.message ?? "no row returned");
      return {
        success: false,
        message: "Could not create the API key. Please try again.",
      };
    }

    return {
      success: true,
      rawKey,
      keyId: newKey.id,
      prefix,
      expiresAtIso: apiKeyExpiresAtIso,
    };
  } catch (err) {
    console.error(
      "[createApiKey] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error creating API key." };
  }
}
