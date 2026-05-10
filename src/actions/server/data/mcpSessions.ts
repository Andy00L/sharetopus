import "server-only";

import { adminSupabase } from "@/actions/api/adminSupabase";

/**
 * Upserts an mcp_sessions row. Idempotent on (id):
 * - First call for a given id: INSERT with started_at + last_activity_at = now()
 * - Subsequent calls for same id: UPDATE last_activity_at = now()
 *
 * Best-effort. Caller MUST tolerate failure without aborting the tool call.
 *
 * Returns: { success: true } | { success: false, message }
 * Persists: one row in mcp_sessions, or updates last_activity_at on conflict.
 */
export async function upsertMcpSession(input: {
  id: string;
  principal_id: string;
  api_key_id?: string | null;
  oauth_client_id?: string | null;
  ip_hash?: string | null;
  client_name?: string | null;
  client_version?: string | null;
}): Promise<{ success: true } | { success: false; message: string }> {
  try {
    const { error } = await adminSupabase.from("mcp_sessions").upsert(
      {
        id: input.id,
        principal_id: input.principal_id,
        api_key_id: input.api_key_id ?? null,
        oauth_client_id: input.oauth_client_id ?? null,
        ip_hash: input.ip_hash ?? null,
        client_name: input.client_name ?? null,
        client_version: input.client_version ?? null,
        last_activity_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error(
        `[upsertMcpSession] Upsert failed for session ${input.id}:`,
        error.message
      );
      return { success: false, message: `Upsert failed: ${error.message}` };
    }

    return { success: true };
  } catch (err) {
    console.error(
      "[upsertMcpSession] Unexpected error:",
      err instanceof Error ? err.message : err
    );
    return {
      success: false,
      message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
