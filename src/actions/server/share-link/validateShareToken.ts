import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";
import type { ShareLink } from "@/lib/types/database.types";

/**
 * Read-only validation of a share link token.
 *
 * Checks format, existence, revocation status, expiry, and usage cap
 * WITHOUT mutating used_count. Used by the landing page to pre-validate
 * before rendering, and by the initiate route before starting OAuth.
 *
 * The actual consumption (used_count increment) happens only via the
 * consume_share_link RPC at OAuth callback success.
 *
 * Called by: share landing page, initiate route, OAuth callback (re-check)
 * Tables read: share_links (select only)
 */

type ValidateSuccess = {
  success: true;
  data: ShareLink;
};

type ValidateFailure = {
  success: false;
  reason:
    | "invalid_format"
    | "not_found"
    | "revoked"
    | "expired"
    | "max_uses_reached";
};

export type ValidateShareTokenResult = ValidateSuccess | ValidateFailure;

/** Base64url tokens from randomBytes(32) are exactly 43 characters, [A-Za-z0-9_-]. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function validateShareToken(
  token: string,
): Promise<ValidateShareTokenResult> {
  // Format check: base64url, 43 chars
  if (!TOKEN_PATTERN.test(token)) {
    return { success: false, reason: "invalid_format" };
  }

  const { data: shareLink, error } = await adminSupabase
    .from("share_links")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error(
      `[validateShareToken] DB error looking up token: ${error.message}`,
    );
    return { success: false, reason: "not_found" };
  }

  if (!shareLink) {
    return { success: false, reason: "not_found" };
  }

  if (shareLink.revoked_at !== null) {
    return { success: false, reason: "revoked" };
  }

  if (
    shareLink.expires_at !== null &&
    new Date(shareLink.expires_at) < new Date()
  ) {
    return { success: false, reason: "expired" };
  }

  // Defensive >= (not just ==) to catch any over-increment bugs
  if (
    shareLink.max_uses !== null &&
    shareLink.used_count >= shareLink.max_uses
  ) {
    return { success: false, reason: "max_uses_reached" };
  }

  return { success: true, data: shareLink };
}

/**
 * Validates a share link by its id rather than token.
 *
 * Used during the OAuth callback when we have the share_link_id from
 * the social_connections row but not the original token.
 *
 * Called by: handleOAuthCallback (share link re-validation step)
 * Tables read: share_links (select only)
 */
export async function validateShareLinkById(
  shareLinkId: string,
): Promise<ValidateShareTokenResult> {
  const { data: shareLink, error } = await adminSupabase
    .from("share_links")
    .select("*")
    .eq("id", shareLinkId)
    .maybeSingle();

  if (error) {
    console.error(
      `[validateShareLinkById] DB error looking up id: ${error.message}`,
    );
    return { success: false, reason: "not_found" };
  }

  if (!shareLink) {
    return { success: false, reason: "not_found" };
  }

  if (shareLink.revoked_at !== null) {
    return { success: false, reason: "revoked" };
  }

  if (
    shareLink.expires_at !== null &&
    new Date(shareLink.expires_at) < new Date()
  ) {
    return { success: false, reason: "expired" };
  }

  if (
    shareLink.max_uses !== null &&
    shareLink.used_count >= shareLink.max_uses
  ) {
    return { success: false, reason: "max_uses_reached" };
  }

  return { success: true, data: shareLink };
}
