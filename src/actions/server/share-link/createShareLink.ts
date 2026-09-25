"use server";

import { checkActiveSubscription } from "@/actions/checkActiveSubscription";
import { checkRateLimit } from "@/actions/server/rateLimit/checkRateLimit";
import { generateShareToken } from "@/actions/server/share-link/lib/token";
import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { hashToken } from "@/lib/api/tokens";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { tierMeets } from "@/lib/types/plans";
import { auth } from "@clerk/nextjs/server";

/**
 * Creates a new share link for a given platform.
 *
 * Gated to Creator+ tier. Validates inputs, generates a secure token,
 * inserts a share_links row, and returns the public URL. The token is
 * stored encrypted, so the owner can copy the link again, and hashed in
 * token_hash, which validateShareToken looks it up by.
 *
 * Called by: CreateShareLinkDialog client component
 * Tables touched: share_links (insert)
 */

const VALID_EXPIRY_SECONDS = new Set<number>([3600, 21600, 86400]);
const VALID_MAX_USES = new Set<number>([1, 5, 10]);

interface CreateShareLinkInput {
  platform: "tiktok";
  expirySeconds: number | null;
  maxUses: number | null;
}

type CreateShareLinkResult =
  | {
      success: true;
      data: { shareUrl: string; shareLinkId: string; expiresAt: string | null };
    }
  | { success: false; message: string };

export async function createShareLink(
  input: CreateShareLinkInput,
): Promise<CreateShareLinkResult> {
  const startMs = performance.now();

  // 1. Auth
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  // 2. Tier gate: Creator+
  const subscription = await checkActiveSubscription(userId);
  if (subscription.status === "unavailable") {
    return {
      success: false,
      message: "Could not check your subscription. Please try again.",
    };
  }
  if (!subscription.isActive || !tierMeets(subscription.tier, "creator")) {
    return {
      success: false,
      message:
        "A Creator or higher subscription is required to create share links.",
    };
  }

  // 3. Rate limit: 10 per minute per user
  const rateLimitResult = await checkRateLimit(
    "shareLink.create",
    userId,
    10,
    60,
  );
  if (!rateLimitResult.success) {
    return { success: false, message: rateLimitResult.message };
  }

  // 4. Validate inputs
  if (input.platform !== "tiktok") {
    return {
      success: false,
      message: "Only TikTok is supported for share links at this time.",
    };
  }

  if (
    input.expirySeconds !== null &&
    !VALID_EXPIRY_SECONDS.has(input.expirySeconds)
  ) {
    return {
      success: false,
      message: "Invalid expiry duration. Choose 1 hour, 6 hours, or 24 hours.",
    };
  }

  if (input.maxUses !== null && !VALID_MAX_USES.has(input.maxUses)) {
    return {
      success: false,
      message: "Invalid max uses. Choose 1, 5, or 10.",
    };
  }

  // 5. Generate token and compute expiry
  const token = generateShareToken();
  const expiresAt =
    input.expirySeconds !== null
      ? new Date(Date.now() + input.expirySeconds * 1000).toISOString()
      : null;

  // 6. Insert share_links row
  const { data: insertedShareLinks, error: insertError } = await runQuery(
    db
      .insert(share_links)
      .values({
        owner_principal_id: userId,
        platform: input.platform,
        token,
        token_hash: hashToken(token),
        expires_at: expiresAt,
        max_uses: input.maxUses,
      })
      .returning({ id: share_links.id }),
  );
  const shareLink = insertedShareLinks?.[0];

  if (insertError || !shareLink) {
    console.error(
      `[createShareLink] Insert failed for user ${userId}:`,
      insertError?.message ?? "no row returned",
    );
    return { success: false, message: "Failed to create share link." };
  }

  // 7. Audit log
  logX402Call({
    principal: null,
    action: "share_link.create",
    endpoint: "/actions/createShareLink",
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
  });

  // 8. Build and return the share URL
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    process.env.NEXT_PUBLIC_BASE_URL ??
    "https://sharetopus.com";
  const shareUrl = `${baseUrl}/share/${input.platform}/${token}`;

  return {
    success: true,
    data: {
      shareUrl,
      shareLinkId: shareLink.id,
      expiresAt,
    },
  };
}
