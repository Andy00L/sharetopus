"use server";

import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";

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

  const { data: rows, error } = await runQuery(
    db
      .select({
        id: share_links.id,
        platform: share_links.platform,
        token: share_links.token,
        created_at: share_links.created_at,
        expires_at: share_links.expires_at,
        max_uses: share_links.max_uses,
        used_count: share_links.used_count,
        last_used_at: share_links.last_used_at,
      })
      .from(share_links)
      .where(
        and(
          eq(share_links.owner_principal_id, userId),
          isNull(share_links.revoked_at),
          or(
            isNull(share_links.expires_at),
            gt(share_links.expires_at, new Date().toISOString()),
          ),
        ),
      )
      .orderBy(desc(share_links.created_at))
      .limit(50),
  );

  if (error) {
    console.error(
      `[listShareLinks] Query failed for user ${userId}:`,
      error.message,
    );
    return { success: false, message: "Failed to load share links." };
  }

  const summaries: ShareLinkSummary[] = rows.map((row) => ({
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
