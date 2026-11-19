"use server";

import { db, runQuery } from "@/db/client";
import { share_links } from "@/db/schema";
import { logX402Call } from "@/lib/x402/audit/logX402Call";
import { auth } from "@clerk/nextjs/server";
import { and, eq, isNull } from "drizzle-orm";

interface RevokeShareLinkInput {
  shareLinkId: string;
}

type RevokeShareLinkResult =
  | { success: true }
  | { success: false; message: string };

export async function revokeShareLink(
  input: RevokeShareLinkInput,
): Promise<RevokeShareLinkResult> {
  const startMs = performance.now();

  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: "Authentication required." };
  }

  if (!input.shareLinkId) {
    return { success: false, message: "Share link ID is required." };
  }

  const { error: updateError } = await runQuery(
    db
      .update(share_links)
      .set({ revoked_at: new Date().toISOString() })
      .where(
        and(
          eq(share_links.id, input.shareLinkId),
          eq(share_links.owner_principal_id, userId),
          isNull(share_links.revoked_at),
        ),
      ),
  );

  if (updateError) {
    console.error(
      `[revokeShareLink] Update failed for link ${input.shareLinkId}:`,
      updateError.message,
    );
    return { success: false, message: "Failed to revoke share link." };
  }

  logX402Call({
    principal: null,
    action: "share_link.revoke",
    endpoint: "/actions/revokeShareLink",
    chargeId: null,
    resultStatus: "ok",
    latencyMs: Math.round(performance.now() - startMs),
  });

  return { success: true };
}
