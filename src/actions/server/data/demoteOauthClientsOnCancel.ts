import "server-only";
import { adminSupabase } from "@/actions/api/adminSupabase";

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
    const { data, error } = await adminSupabase
      .from("mcp_oauth_clients")
      .update({ trust_level: "unverified" })
      .eq("registered_by_user_id", principalId)
      .eq("trust_level", "verified")
      .select("client_id");

    if (error) {
      return {
        success: false,
        message: `[demoteOauthClientsOnCancel] ${error.message}`,
      };
    }

    const count = data?.length ?? 0;
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
