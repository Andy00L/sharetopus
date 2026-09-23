import "server-only";

import { and, eq } from "drizzle-orm";

import { db, runQuery } from "@/db/client";
import { mcp_oauth_clients } from "@/db/schema";

export type DemoteResult =
  | { success: true; demoted: number }
  | { success: false; message: string };

/**
 * Demotes all verified OAuth clients registered by a user to unverified.
 * Called when the user's Stripe subscription is cancelled.
 *
 * The trust drop is permanent: on resubscribe, clients stay unverified
 * until manually promoted OR until they register fresh clients that hit
 * the auto-verify rule.
 */
export async function demoteOauthClientsOnCancel(
  principalId: string
): Promise<DemoteResult> {
  try {
    const { data, error } = await runQuery(
      db
        .update(mcp_oauth_clients)
        .set({ trust_level: "unverified" })
        .where(
          and(
            eq(mcp_oauth_clients.registered_by_user_id, principalId),
            eq(mcp_oauth_clients.trust_level, "verified"),
          ),
        )
        .returning({ client_id: mcp_oauth_clients.client_id }),
    );

    if (error) {
      return {
        success: false,
        message: `[demoteOauthClientsOnCancel] ${error.message}`,
      };
    }

    const count = data.length;
    if (count > 0) {
      console.log(
        `[demoteOauthClientsOnCancel] Demoted ${count} clients for principal ${principalId}`
      );
    }
    return { success: true, demoted: count };
  } catch (err) {
    return {
      success: false,
      message: `[demoteOauthClientsOnCancel] Unexpected: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
