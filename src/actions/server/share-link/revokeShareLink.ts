"use server";

import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull, type SQL } from "drizzle-orm";

interface RevokeShareLinkInput {
  shareLinkId: string;
}

type RevokeShareLinkResult =
  | { success: true; outcome: "revoked" | "already_revoked" }
  | { success: false; reason: "not_found" | "failed"; message: string };

export async function revokeShareLink(
  input: RevokeShareLinkInput,
): Promise<RevokeShareLinkResult> {
  const startMs = performance.now();

  const { userId } = await auth();
  if (!userId) {
    return { success: false, reason: "failed", message: "Authentication required." };
  }

  if (!input.shareLinkId) {
    return { success: false, reason: "not_found", message: "Share link ID is required." };
  }

  const isOwnedLink = and(
    eq(share_links.id, input.shareLinkId),
    eq(share_links.owner_principal_id, userId),
  );
  const { data: revokedRows, error: updateError } = await runQuery(
    db
      .update(share_links)
      .set({ revoked_at: new Date().toISOString() })
      .where(and(isOwnedLink, isNull(share_links.revoked_at)))
      .returning({ id: share_links.id }),
  );

  if (updateError) {
    console.error(
      `[revokeShareLink] Update failed for link ${input.shareLinkId}:`,
      updateError.message,
    );
    return { success: false, reason: "failed", message: "Failed to revoke share link." };
  }

  if (revokedRows.length === 0) {
    return findUnrevokableOutcome(isOwnedLink, input.shareLinkId);
  }

  logX402Call({
    principal: null,
    action: "share_link.revoke",
    endpoint: "/actions/revokeShareLink",
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
  });

  return { success: true, outcome: "revoked" };
}

async function findUnrevokableOutcome(
  isOwnedLink: SQL | undefined,
  shareLinkId: string,
): Promise<RevokeShareLinkResult> {
  const { data: ownedRows, error } = await runQuery(
    db
      .select({ id: share_links.id })
      .from(share_links)
      .where(isOwnedLink)
      .limit(1),
  );
  if (error) {
    console.error(
      `[findUnrevokableOutcome] Lookup failed for link ${shareLinkId}:`,
      error.message,
    );
    return { success: false, reason: "failed", message: "Failed to revoke share link." };
  }
  if (ownedRows.length === 0) {
    return { success: false, reason: "not_found", message: "Share link not found." };
  }
  return { success: true, outcome: "already_revoked" };
}
