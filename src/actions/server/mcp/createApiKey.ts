"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { authCheck } from "@/actions/server/authCheck";
import { generateMcpApiKey } from "@/lib/mcp/tokens";
import { checkRateLimit } from "../rateLimit/checkRateLimit";

/**
 * Creates a new MCP API key for the authenticated user.
 *
 * Requires an active Stripe subscription. MCP is a paid feature, so
 * Free users see a paywall message instead of generating a key that
 * would never authenticate (the auth resolver also checks subscription).
 *
 * The raw key is returned exactly once. After this call, only the
 * prefix and metadata are visible. The key hash is stored in
 * api_keys.token_hash for lookup during MCP requests.
 *
 * Respects the enforce_api_key_kind_matrix trigger: kind must be
 * 'mcp' and the principal must be a Clerk user.
 *
 * Called by: src/app/(protected)/integrations/components/ApiKeysCard.tsx
 * Tables read: stripe_subscriptions
 * Tables touched: api_keys (insert)
 */
export async function createApiKey(
  userId: string | null,
  name: string
): Promise<{
  success: boolean;
  message: string;
  rawKey?: string;
  keyId?: string;
}> {
  try {
    const authResult = await authCheck(userId);
    if (!authResult || !userId) {
      return { success: false, message: "Authentication required." };
    }

    // MCP is a paid feature. Block key creation for users without an active subscription.
    const sub = await checkActiveSubscription(userId);
    if (!sub.isActive) {
      return {
        success: false,
        message: "An active Sharetopus subscription is required to create MCP API keys.",
      };
    }

    const rateCheck = await checkRateLimit("mcp.createApiKey", userId, 10, 60);
    if (!rateCheck.success) {
      return {
        success: false,
        message: rateCheck.message ?? "Rate limited.",
      };
    }

    if (!name || name.trim().length === 0) {
      return { success: false, message: "Key name is required." };
    }
    if (name.length > 100) {
      return { success: false, message: "Key name must be under 100 characters." };
    }

    // Check existing key count (limit to 10 active keys per user)
    const { count } = await adminSupabase
      .from("api_keys")
      .select("id", { count: "exact", head: true })
      .eq("principal_id", userId)
      .eq("kind", "mcp")
      .is("revoked_at", null);

    if ((count ?? 0) >= 10) {
      return {
        success: false,
        message: "Maximum 10 active MCP keys allowed. Revoke an existing key first.",
      };
    }

    const { rawKey, prefix, tokenHash } = generateMcpApiKey();

    const { data: newKey, error } = await adminSupabase
      .from("api_keys")
      .insert({
        principal_id: userId,
        name: name.trim(),
        prefix,
        token_hash: tokenHash,
        kind: "mcp",
        scopes: ["mcp:*"],
      })
      .select("id")
      .single();

    if (error) {
      console.error("[createApiKey] Insert failed:", error.message);
      return {
        success: false,
        message: `Failed to create API key: ${error.message}`,
      };
    }

    return {
      success: true,
      message: "API key created. Copy the key now, it will not be shown again.",
      rawKey,
      keyId: newKey.id,
    };
  } catch (err) {
    console.error(
      "[createApiKey] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return { success: false, message: "Unexpected error creating API key." };
  }
}
