import "server-only";

import { eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { hashToken } from "@/lib/api/tokens";
import { isShareTokenFormat } from "./lib/token";

type ShareLinkRow = typeof share_links.$inferSelect;

type ValidateSuccess = {
  success: true;
  data: ShareLinkRow;
};

export type ShareLinkRefusal =
  | "invalid_format"
  | "not_found"
  | "revoked"
  | "expired"
  | "max_uses_reached"
  | "lookup_failed";

type ValidateFailure = {
  success: false;
  reason: ShareLinkRefusal;
};

export type ValidateShareTokenResult = ValidateSuccess | ValidateFailure;

export async function validateShareToken(
  token: string,
): Promise<ValidateShareTokenResult> {
  if (!isShareTokenFormat(token)) {
    return { success: false, reason: "invalid_format" };
  }

  const { data: shareLinkRows, error } = await runQuery(
    db
      .select()
      .from(share_links)
      .where(eq(share_links.token_hash, hashToken(token)))
      .limit(1),
  );

  if (error) {
    console.error(
      `[validateShareToken] DB error looking up token: ${error.message}`,
    );
    return { success: false, reason: "lookup_failed" };
  }

  return evaluateShareLink(shareLinkRows[0]);
}

export async function validateShareLinkById(
  shareLinkId: string,
): Promise<ValidateShareTokenResult> {
  const { data: shareLinkRows, error } = await runQuery(
    db
      .select()
      .from(share_links)
      .where(eq(share_links.id, shareLinkId))
      .limit(1),
  );

  if (error) {
    console.error(
      `[validateShareLinkById] DB error looking up id: ${error.message}`,
    );
    return { success: false, reason: "lookup_failed" };
  }

  return evaluateShareLink(shareLinkRows[0]);
}

function evaluateShareLink(
  shareLink: ShareLinkRow | undefined,
): ValidateShareTokenResult {
  if (!shareLink) {
    return { success: false, reason: "not_found" };
  }

  if (shareLink.revoked_at !== null) {
    return { success: false, reason: "revoked" };
  }

  if (
    shareLink.expires_at !== null &&
    new Date(shareLink.expires_at) <= new Date()
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
