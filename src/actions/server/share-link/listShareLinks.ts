"use server";

import { adminSupabase } from "@/actions/api/adminSupabase";
import { auth } from "@clerk/nextjs/server";

/**
 * Lists all active (non-revoked, non-expired) share links for the
 * authenticated user. Used by the connections page to display the
 * creator's active share links.
 *
 * Called by: ShareLinkList server component
 * Tables read: share_links (select)
 */

export interface ShareLinkSummary {
  id: string;
  platform: string;
  token: string;
  createdAt: string;
  expiresAt: string | null;
  maxUses: number | null;
  usedCount: number;
  lastUsedAt: string | null;
}

type ListShareLinksResult =
  | { success: true; data: ShareLinkSummary[] }
  | { success: false; message: string };

export async function listShareLinks(): Promise<ListShareLinksResult> {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  const { data: rows, error } = await adminSupabase
    .from("share_links")
    .select(
      "id, platform, token, created_at, expires_at, max_uses, used_count, last_used_at",
    )
    .eq("owner_principal_id", userId)
    .is("revoked_at", null)
    .or("expires_at.is.null,expires_at.gt." + new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error(
      `[listShareLinks] Query failed for user ${userId}:`,
      error.message,
    );
    return { success: false, message: "Failed to load share links." };
  }

  const summaries: ShareLinkSummary[] = (rows ?? []).map((row) => ({
    id: row.id,
    platform: row.platform,
    token: row.token,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    usedCount: row.used_count,
    lastUsedAt: row.last_used_at,
  }));

  return { success: true, data: summaries };
}
